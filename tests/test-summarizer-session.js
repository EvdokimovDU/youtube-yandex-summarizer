import assert from 'node:assert';
import { getSignature, getUUID, getSecYaHeaders } from '../src/summarizer/core/crypto.js';
import { encodeSessionRequest, decodeSessionResponse, YandexSessionManager } from '../src/summarizer/core/session.js';

console.log('=== Running Yandex Summarizer Session & Crypto Tests ===\n');

let passedTests = 0;

async function runTests() {
  // Test 1: getSignature
  console.log('Test 1: HMAC-SHA256 getSignature produces correct hex string');
  const testString = 'test';
  const expectedSig = 'ef02ef65d4b0c97334b2e2840177ba354f5b7e530200636dfe5b969eda9442e4';
  const actualSig = await getSignature(testString);
  assert.strictEqual(actualSig, expectedSig, 'Signature for "test" must match known HMAC-SHA256 hex');

  // Test with Uint8Array
  const uint8Input = new TextEncoder().encode(testString);
  const actualSigFromBytes = await getSignature(uint8Input);
  assert.strictEqual(actualSigFromBytes, expectedSig, 'Signature for Uint8Array input must match');
  console.log('✓ Test 1 passed: getSignature produces valid HMAC-SHA256 hex');
  passedTests++;

  // Test 2: getUUID
  console.log('\nTest 2: getUUID generates 32-character uppercase hexadecimal string');
  const uuid1 = getUUID();
  const uuid2 = getUUID();
  assert.strictEqual(typeof uuid1, 'string');
  assert.strictEqual(uuid1.length, 32, 'UUID must be 32 characters long');
  assert.match(uuid1, /^[0-9A-F]{32}$/, 'UUID must be uppercase hexadecimal');
  assert.notStrictEqual(uuid1, uuid2, 'Consecutive UUIDs must be random and unique');
  console.log(`✓ Test 2 passed: getUUID produces valid UUID (${uuid1})`);
  passedTests++;

  // Test 3: getSecYaHeaders
  console.log('\nTest 3: getSecYaHeaders produces correct headers for Ya-Summary and Vtrans');
  const dummySession = {
    uuid: '562758BF13B84D0F9B18CA7A2DDF01F2',
    secretKey: 'sample_secret_key_12345'
  };
  const path = '/api/neuro/generation';
  const yaHeaders = await getSecYaHeaders('Ya-Summary', dummySession, path);
  assert.strictEqual(yaHeaders['X-Ya-Summary-Sk'], dummySession.secretKey);
  assert.ok(yaHeaders['X-Ya-Summary-Token'], 'Must have X-Ya-Summary-Token header');
  assert.ok(yaHeaders['X-Ya-Summary-Token'].includes(dummySession.uuid), 'Token must include uuid');
  assert.ok(yaHeaders['X-Ya-Summary-Token'].includes(path), 'Token must include path');
  assert.ok(yaHeaders['X-Ya-Summary-Token'].includes('26.8.3.1002'), 'Token must include component version');

  const vtransHeaders = await getSecYaHeaders('Vtrans', dummySession, path);
  assert.strictEqual(vtransHeaders['Sec-Vtrans-Sk'], dummySession.secretKey);
  assert.ok(vtransHeaders['Sec-Vtrans-Token'], 'Must have Sec-Vtrans-Token header');
  assert.ok(vtransHeaders['Sec-Vtrans-Token'].includes(dummySession.uuid), 'Token must include uuid');
  console.log('✓ Test 3 passed: getSecYaHeaders generates valid security headers');
  passedTests++;

  // Test 4: encodeSessionRequest
  console.log('\nTest 4: encodeSessionRequest matches exact Protobuf wire-format');
  const testUUID = '562758BF13B84D0F9B18CA7A2DDF01F2';
  const testModule = 'neuroapi';
  const encoded = encodeSessionRequest(testUUID, testModule);

  const uuidBytes = Array.from(new TextEncoder().encode(testUUID));
  const moduleBytes = Array.from(new TextEncoder().encode(testModule));
  const expectedBytes = new Uint8Array([0x0a, 32, ...uuidBytes, 0x12, 8, ...moduleBytes]);

  assert.strictEqual(encoded instanceof Uint8Array, true, 'encodeSessionRequest must return Uint8Array');
  assert.strictEqual(encoded.length, expectedBytes.length, `Expected length ${expectedBytes.length}, got ${encoded.length}`);
  assert.deepStrictEqual(Array.from(encoded), Array.from(expectedBytes), 'Encoded bytes must match expected protobuf payload');
  console.log('✓ Test 4 passed: encodeSessionRequest wire-format is byte-for-byte exact');
  passedTests++;

  // Test 5: decodeSessionResponse
  console.log('\nTest 5: decodeSessionResponse parses secretKey and expires');
  // Construct a synthetic protobuf response:
  // field 1 (string "my_secret_key"): tag 0x0a, length 13, bytes
  // field 2 (varint 3600): tag 0x10, varint 3600 (3600 = 0x0e10 -> 0x90, 0x1c)
  const secretBytes = Array.from(new TextEncoder().encode('my_secret_key'));
  const syntheticResponse = new Uint8Array([
    0x0a, secretBytes.length, ...secretBytes,
    0x10, 0x90, 0x1c
  ]);
  const decoded = decodeSessionResponse(syntheticResponse);
  assert.strictEqual(decoded.secretKey, 'my_secret_key', 'Decoded secretKey must match');
  assert.strictEqual(decoded.expires, 3600, 'Decoded expires must match 3600');
  console.log('✓ Test 5 passed: decodeSessionResponse correctly parses synthetic protobuf response');
  passedTests++;

  // Test 6: YandexSessionManager caching behavior
  console.log('\nTest 6: YandexSessionManager caches valid sessions in memory');
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => syntheticResponse.buffer
    };
  };

  const mockManager = new YandexSessionManager({ fetchFn: mockFetch });
  const s1 = await mockManager.getSession('neuroapi');
  assert.strictEqual(fetchCallCount, 1, 'First call must fetch session');
  assert.strictEqual(s1.secretKey, 'my_secret_key');

  const s2 = await mockManager.getSession('neuroapi');
  assert.strictEqual(fetchCallCount, 1, 'Second call must return cached session');
  assert.strictEqual(s1.uuid, s2.uuid, 'Cached session uuid must match');
  assert.strictEqual(s1.secretKey, s2.secretKey, 'Cached session secretKey must match');

  const sDifferentModule = await mockManager.getSession('vtrans');
  assert.strictEqual(fetchCallCount, 2, 'Different module must fetch a new session');
  console.log('✓ Test 6 passed: YandexSessionManager properly caches and segregates sessions by module');
  passedTests++;

  // Test 7: Live integration test against api.browser.yandex.ru
  console.log('\nTest 7: Live network handshake with api.browser.yandex.ru/session/create');
  const liveManager = new YandexSessionManager();
  const liveSession = await liveManager.getSession('neuroapi');
  assert.ok(liveSession, 'Live session must be returned');
  assert.ok(liveSession.uuid && liveSession.uuid.length === 32, 'Live session must have 32-char UUID');
  assert.ok(typeof liveSession.secretKey === 'string' && liveSession.secretKey.length > 0, 'Live session must have non-empty secretKey');
  assert.strictEqual(liveSession.expires, 3600, 'Live session expires must equal 3600');
  console.log(`✓ Test 7 passed: Live session successfully obtained! UUID: ${liveSession.uuid}, Expires: ${liveSession.expires}s, SecretKey length: ${liveSession.secretKey.length}`);
  passedTests++;

  console.log(`\n🎉 ALL ${passedTests} TESTS PASSED SUCCESSFULLY! 🎉`);
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});

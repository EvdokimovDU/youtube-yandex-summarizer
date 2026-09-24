import assert from 'node:assert';
import {
  extractYouTubeVideoId,
  canonicalYouTubeUrl,
  formatTimecode,
  YandexVideoSummarizer
} from '../src/summarizer/api/client.js';
import { SummaryCache } from '../src/summarizer/api/cache.js';

console.log('=== Running Yandex Summarizer API & Cache Tests ===\n');

let passedTests = 0;

async function runTests() {
  // ==========================================
  // Test 1: extractYouTubeVideoId
  // ==========================================
  console.log('Test 1: extractYouTubeVideoId extracts video ID across multiple URL formats');
  const validCases = [
    { input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'http://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', expected: 'dQw4w9WgXcQ' },
    { input: 'https://m.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtu.be/dQw4w9WgXcQ?t=10s', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/live/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', expected: 'dQw4w9WgXcQ' },
    { input: 'dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: '  dQw4w9WgXcQ  ', expected: 'dQw4w9WgXcQ' }
  ];

  for (const { input, expected } of validCases) {
    const actual = extractYouTubeVideoId(input);
    assert.strictEqual(actual, expected, `extractYouTubeVideoId failed for: ${input}`);
  }

  const invalidCases = [
    '',
    null,
    undefined,
    'https://vimeo.com/12345678',
    'https://google.com',
    'not_a_video_id',
    'https://youtube.com/watch?v=short'
  ];

  for (const input of invalidCases) {
    const actual = extractYouTubeVideoId(input);
    assert.strictEqual(actual, null, `extractYouTubeVideoId should return null for invalid input: ${input}`);
  }

  console.log('✓ Test 1 passed: extractYouTubeVideoId successfully parses all valid YouTube formats');
  passedTests++;

  // ==========================================
  // Test 2: canonicalYouTubeUrl
  // ==========================================
  console.log('\nTest 2: canonicalYouTubeUrl produces standard watch URL');
  assert.strictEqual(
    canonicalYouTubeUrl('dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  console.log('✓ Test 2 passed: canonicalYouTubeUrl format is correct');
  passedTests++;

  // ==========================================
  // Test 3: formatTimecode
  // ==========================================
  console.log('\nTest 3: formatTimecode converts seconds into MM:SS and HH:MM:SS');
  const timecodeCases = [
    { input: 0, expected: '00:00' },
    { input: 5, expected: '00:05' },
    { input: 65, expected: '01:05' },
    { input: 75, expected: '01:15' },
    { input: 599, expected: '09:59' },
    { input: 3600, expected: '01:00:00' },
    { input: 3661, expected: '01:01:01' },
    { input: 3665, expected: '01:01:05' },
    { input: 7325, expected: '02:02:05' }
  ];

  for (const { input, expected } of timecodeCases) {
    const actual = formatTimecode(input);
    assert.strictEqual(actual, expected, `formatTimecode(${input}) expected ${expected}, got ${actual}`);
  }
  console.log('✓ Test 3 passed: formatTimecode works for all durations');
  passedTests++;

  // ==========================================
  // Test 4: SummaryCache (in-memory, TTL, persistence)
  // ==========================================
  console.log('\nTest 4: SummaryCache in-memory operations and TTL expiration');
  const cache = new SummaryCache();
  cache.set('vid1', { title: 'Video 1' });
  assert.strictEqual(cache.has('vid1'), true);
  assert.deepStrictEqual(cache.get('vid1'), { title: 'Video 1' });
  assert.strictEqual(cache.has('vid2'), false);
  assert.strictEqual(cache.get('vid2'), null);

  // Expiration test
  cache.set('short_lived', { title: 'Ephemeral' }, 50); // 50ms TTL
  assert.strictEqual(cache.has('short_lived'), true);
  await new Promise(r => setTimeout(r, 70));
  assert.strictEqual(cache.get('short_lived'), null, 'Expired item should return null');
  assert.strictEqual(cache.has('short_lived'), false, 'Expired item has() should be false');

  cache.clear();
  assert.strictEqual(cache.has('vid1'), false);
  console.log('✓ Test 4 passed: SummaryCache in-memory and TTL work as expected');
  passedTests++;

  // ==========================================
  // Test 5: SummaryCache storage adapter compatibility
  // ==========================================
  console.log('\nTest 5: SummaryCache storage adapter compatibility (localStorage & GM_getValue)');
  const mockStorageMap = new Map();
  const customAdapter = {
    get: (key) => mockStorageMap.get(key) || null,
    set: (key, value) => mockStorageMap.set(key, value)
  };

  const persistentCache = new SummaryCache({ storage: customAdapter });
  persistentCache.set('persisted_vid', { title: 'Persisted Video' });

  // Create a brand new cache instance pointing to the same storage
  const restoredCache = new SummaryCache({ storage: customAdapter });
  assert.strictEqual(restoredCache.has('persisted_vid'), true);
  assert.deepStrictEqual(restoredCache.get('persisted_vid'), { title: 'Persisted Video' });

  // Test localStorage API (getItem / setItem with JSON strings)
  const mockLocalStorageData = {};
  const localStorageMock = {
    getItem: (k) => mockLocalStorageData[k] || null,
    setItem: (k, v) => { mockLocalStorageData[k] = String(v); }
  };
  const lsCache = new SummaryCache({ storage: localStorageMock });
  lsCache.set('ls_vid', { title: 'Local Storage Video' });
  const lsRestoredCache = new SummaryCache({ storage: localStorageMock });
  assert.deepStrictEqual(lsRestoredCache.get('ls_vid'), { title: 'Local Storage Video' });

  // Test canonical URL key normalization
  const urlCache = new SummaryCache();
  urlCache.set('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { title: 'Normalized' });
  assert.strictEqual(urlCache.has('dQw4w9WgXcQ'), true, 'Should find entry by videoId when set with canonical URL');
  assert.deepStrictEqual(urlCache.get('dQw4w9WgXcQ'), { title: 'Normalized' });
  assert.deepStrictEqual(urlCache.get('https://youtu.be/dQw4w9WgXcQ'), { title: 'Normalized' });

  console.log('✓ Test 5 passed: SummaryCache works with custom adapters, localStorage, and URL key normalization');
  passedTests++;

  // ==========================================
  // Test 6: YandexVideoSummarizer with Mock Responses (Unit tests)
  // ==========================================
  console.log('\nTest 6: YandexVideoSummarizer unit tests with mock API responses');
  const mockSession = {
    uuid: '11112222333344445555666677778888',
    secretKey: 'mock_sk_123',
    expires: 3600,
    timestamp: Date.now()
  };

  const mockSessionManager = {
    getSession: async () => mockSession
  };

  // 6a: Invalid video URL or ID throws
  const summarizerWithMock = new YandexVideoSummarizer({
    sessionManager: mockSessionManager,
    fetchFn: async () => assert.fail('Should not call fetch for invalid ID')
  });

  await assert.rejects(
    () => summarizerWithMock.summarizeVideo('https://example.com/not-youtube'),
    /Invalid YouTube URL or Video ID/
  );

  // 6b: Polling progression: status_code 1 -> status_code 0
  let pollCount = 0;
  const progressEvents = [];
  const mockFetchPolling = async (url, opts) => {
    pollCount++;
    if (pollCount === 1) {
      // Initial request: return status_code 1 (in progress)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 1,
          session_id: 'session_abc_123',
          poll_interval_ms: 20,
          approximate_waiting_time: 2
        })
      };
    }
    // Poll request: return status_code 0 (success)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 0,
        title: 'Mocked Video Title',
        sharing_url: 'https://300.ya.ru/mock',
        keypoints: [
          {
            id: 'kp1',
            start_time: 15,
            content: 'Introduction',
            theses: [{ content: 'Point 1' }, { content: 'Point 2' }]
          },
          {
            id: 'kp2',
            start_time: 90,
            content: 'Core Idea',
            theses: [{ content: 'Key takeaway' }]
          }
        ]
      })
    };
  };

  const pollingSummarizer = new YandexVideoSummarizer({
    sessionManager: mockSessionManager,
    fetchFn: mockFetchPolling
  });

  const summaryResult = await pollingSummarizer.summarizeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
    onProgress: (p) => progressEvents.push(p)
  });

  assert.strictEqual(summaryResult.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(summaryResult.title, 'Mocked Video Title');
  assert.strictEqual(summaryResult.keypoints.length, 2);
  assert.strictEqual(summaryResult.keypoints[0].timecode, '00:15');
  assert.deepStrictEqual(summaryResult.keypoints[0].theses, ['Point 1', 'Point 2']);
  assert.strictEqual(summaryResult.keypoints[1].timecode, '01:30');
  assert.strictEqual(progressEvents.length, 1);
  assert.strictEqual(progressEvents[0].statusCode, 1);

  // 6c: Cache hit verification
  const cachedResult = await pollingSummarizer.summarizeVideo('dQw4w9WgXcQ');
  assert.strictEqual(cachedResult.fromCache, true);
  assert.strictEqual(pollCount, 2, 'No new network requests should be made for cached item');

  // 6d: Error status_code 2 throws
  const mockFetchError = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status_code: 2,
      message: 'Video has no spoken dialogue'
    })
  });
  const errorSummarizer = new YandexVideoSummarizer({
    sessionManager: mockSessionManager,
    fetchFn: mockFetchError
  });
  await assert.rejects(
    () => errorSummarizer.summarizeVideo('https://youtu.be/12345678901'),
    /Video has no spoken dialogue/
  );

  // 6e: AbortSignal handling (pre-aborted and during polling)
  const preAbortedController = new AbortController();
  preAbortedController.abort();
  await assert.rejects(
    () => pollingSummarizer.summarizeVideo('https://youtu.be/12345678902', { signal: preAbortedController.signal }),
    (err) => err.name === 'AbortError'
  );

  const abortDuringPollController = new AbortController();
  const abortDuringPollSummarizer = new YandexVideoSummarizer({
    sessionManager: mockSessionManager,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 1,
        session_id: 'session_abort_test',
        poll_interval_ms: 500
      })
    })
  });
  setTimeout(() => abortDuringPollController.abort(), 20);
  await assert.rejects(
    () => abortDuringPollSummarizer.summarizeVideo('https://youtu.be/12345678903', { signal: abortDuringPollController.signal }),
    (err) => err.name === 'AbortError'
  );

  // 6f: Timeout when exceeding max 60 iterations
  let loopCount = 0;
  const timeoutSummarizer = new YandexVideoSummarizer({
    sessionManager: mockSessionManager,
    fetchFn: async () => {
      loopCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 1,
          session_id: 'session_timeout_test',
          poll_interval_ms: 1
        })
      };
    }
  });
  await assert.rejects(
    () => timeoutSummarizer.summarizeVideo('https://youtu.be/12345678904'),
    /Summarization request timed out/
  );
  assert.strictEqual(loopCount, 61, 'Should have made 1 initial request + 60 poll requests before timing out');

  console.log('✓ Test 6 passed: YandexVideoSummarizer handles polling, formatting, caching, errors, aborts, and timeouts correctly');
  passedTests++;

  // ==========================================
  // Test 7: Live Integration Test with Yandex 300.ya.ru API
  // ==========================================
  console.log('\nTest 7: Live integration test with real Yandex API on dQw4w9WgXcQ');
  const liveSummarizer = new YandexVideoSummarizer();
  const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  const liveProgress = [];
  const liveResult = await liveSummarizer.summarizeVideo(testUrl, {
    onProgress: (p) => {
      liveProgress.push(p);
      console.log(`  [Progress] Status: ${p.statusCode}, Interval: ${p.pollInterval}ms, Wait: ~${p.approximateWaitingTime}s`);
    }
  });

  assert.ok(liveResult, 'Result must exist');
  assert.strictEqual(liveResult.videoId, 'dQw4w9WgXcQ');
  assert.ok(Array.isArray(liveResult.keypoints), 'Result must contain keypoints array');
  assert.ok(liveResult.keypoints.length > 0, 'Must have at least 1 keypoint');

  for (const kp of liveResult.keypoints) {
    assert.strictEqual(typeof kp.startTime, 'number', 'Keypoint startTime must be a number');
    assert.ok(typeof kp.timecode === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(kp.timecode), `Valid timecode format expected, got ${kp.timecode}`);
    assert.ok(typeof kp.title === 'string' && kp.title.length > 0, 'Keypoint title must be non-empty string');
    assert.ok(Array.isArray(kp.theses), 'Keypoint theses must be an array');
  }

  console.log(`  Title: "${liveResult.title}"`);
  console.log(`  Keypoints count: ${liveResult.keypoints.length}`);
  console.log(`  Sample keypoint: [${liveResult.keypoints[0].timecode}] ${liveResult.keypoints[0].title}`);
  if (liveResult.keypoints[0].theses.length > 0) {
    console.log(`    - ${liveResult.keypoints[0].theses[0]}`);
  }

  // Verify caching on live instance
  const secondLiveResult = await liveSummarizer.summarizeVideo(testUrl);
  assert.strictEqual(secondLiveResult.fromCache, true, 'Second call must return fromCache: true');
  assert.strictEqual(secondLiveResult.videoId, liveResult.videoId);

  console.log('✓ Test 7 passed: Live Yandex summarization and caching succeeded!');
  passedTests++;

  console.log(`\n🎉 ALL ${passedTests} TESTS PASSED SUCCESSFULLY! 🎉`);
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});

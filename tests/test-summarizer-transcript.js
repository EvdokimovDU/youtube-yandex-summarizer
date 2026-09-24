/**
 * Test Suite: YouTube Transcript & Subtitles Extractor
 * Verifies track selection prioritization, json3 parsing, entity decoding,
 * context extraction, and transcript truncation.
 */

import assert from 'node:assert';
import {
  selectBestCaptionTrack,
  decodeHtmlEntities,
  parseTimedTextEvents,
  truncateTranscriptText,
  extractPlayerCaptions,
  fetchTranscriptFromUrl,
  getVideoTranscript
} from '../src/summarizer/api/transcript.js';

console.log('=== Running YouTube Transcript Extractor Tests ===\n');

let passedTests = 0;

// =========================================================================
// Test 1: Caption Track Selection Prioritization
// =========================================================================
console.log('Test 1: selectBestCaptionTrack prioritizes ru > ru(asr) > en > en(asr) > other');

const mockTracks = [
  { languageCode: 'es', kind: 'asr', baseUrl: 'https://timedtext/es-auto' },
  { languageCode: 'en', kind: 'asr', baseUrl: 'https://timedtext/en-auto' },
  { languageCode: 'en', baseUrl: 'https://timedtext/en-manual' },
  { languageCode: 'ru', kind: 'asr', baseUrl: 'https://timedtext/ru-auto' },
  { languageCode: 'ru', baseUrl: 'https://timedtext/ru-manual' }
];

// With Russian manual present
const best1 = selectBestCaptionTrack(mockTracks);
assert.strictEqual(best1.baseUrl, 'https://timedtext/ru-manual', 'Must select Russian manual track first');

// Without Russian manual, but with Russian ASR
const withoutRuManual = mockTracks.filter(t => t.baseUrl !== 'https://timedtext/ru-manual');
const best2 = selectBestCaptionTrack(withoutRuManual);
assert.strictEqual(best2.baseUrl, 'https://timedtext/ru-auto', 'Must select Russian ASR if manual is absent');

// Without any Russian tracks, but with English manual
const withoutRu = mockTracks.filter(t => t.languageCode !== 'ru');
const best3 = selectBestCaptionTrack(withoutRu);
assert.strictEqual(best3.baseUrl, 'https://timedtext/en-manual', 'Must select English manual when Russian absent');

// Empty tracks
assert.strictEqual(selectBestCaptionTrack([]), null, 'Empty array returns null');
assert.strictEqual(selectBestCaptionTrack(null), null, 'Null returns null');

console.log('✓ Test 1 passed: selectBestCaptionTrack follows strict language priority');
passedTests++;

// =========================================================================
// Test 2: HTML Entity Decoding
// =========================================================================
console.log('\nTest 2: decodeHtmlEntities cleans subtitle characters');
const encoded = 'Привет &amp; добро пожаловать! Это &quot;тест&#39;овое&quot; видео &lt;1&gt;';
const decoded = decodeHtmlEntities(encoded);
assert.strictEqual(decoded, "Привет & добро пожаловать! Это \"тест'овое\" видео <1>");

console.log('✓ Test 2 passed: decodeHtmlEntities decodes common subtitle entities');
passedTests++;

// =========================================================================
// Test 3: parseTimedTextEvents parses json3 format
// =========================================================================
console.log('\nTest 3: parseTimedTextEvents parses YouTube json3 events and builds clean text');
const mockJson3 = {
  wireMagic: 'pb3',
  events: [
    {
      tStartMs: 1200,
      dDurationMs: 2500,
      segs: [{ utf8: 'Всем ' }, { utf8: 'привет!' }]
    },
    {
      tStartMs: 3800,
      dDurationMs: 3000,
      segs: [{ utf8: 'Сегодня мы поговорим о ' }, { utf8: 'банковских картах.' }]
    }
  ]
};

const parsed = parseTimedTextEvents(mockJson3);
assert.strictEqual(parsed.segments.length, 2, 'Must extract 2 segments');
assert.strictEqual(parsed.segments[0].startMs, 1200);
assert.strictEqual(parsed.segments[1].text, 'Сегодня мы поговорим о банковских картах.');
assert.strictEqual(parsed.fullText, 'Всем привет! Сегодня мы поговорим о банковских картах.');

console.log('✓ Test 3 passed: parseTimedTextEvents converts json3 to clean continuous text');
passedTests++;

// =========================================================================
// Test 4: Truncation at sentence or word boundary
// =========================================================================
console.log('\nTest 4: truncateTranscriptText respects maximum characters cleanly');
const longText = 'Первое предложение о технологиях. Второе предложение о микрочипах. Третье длинное предложение о стандарте шифрования EMV.';
const truncated = truncateTranscriptText(longText, 70);
assert.ok(truncated.length <= 70, `Truncated text length ${truncated.length} must be <= 70`);
assert.ok(truncated.includes('Первое предложение'), 'Includes initial part');

console.log('✓ Test 4 passed: truncateTranscriptText truncates cleanly');
passedTests++;

// =========================================================================
// Test 5: extractPlayerCaptions from context
// =========================================================================
console.log('\nTest 5: extractPlayerCaptions retrieves tracks from window / playerData');
const mockContext = {
  window: {
    ytInitialPlayerResponse: {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: 'ru', baseUrl: 'https://timedtext/ru' }]
        }
      }
    }
  }
};

const extractedTracks = extractPlayerCaptions(mockContext);
assert.ok(Array.isArray(extractedTracks), 'Must extract array of tracks');
assert.strictEqual(extractedTracks[0].languageCode, 'ru');

console.log('✓ Test 5 passed: extractPlayerCaptions locates captions in context');
passedTests++;

// =========================================================================
// Test 6: getVideoTranscript end-to-end extraction
// =========================================================================
console.log('\nTest 6: getVideoTranscript fetches and formats full transcript');
const mockFetch = async (url) => {
  assert.ok(url.includes('fmt=json3'), 'Fetch URL must include fmt=json3');
  return {
    ok: true,
    json: async () => mockJson3
  };
};

const transcriptResult = await getVideoTranscript('dQw4w9WgXcQ', {
  context: mockContext,
  fetchFn: mockFetch
});

assert.ok(transcriptResult, 'Transcript result must not be null');
assert.strictEqual(transcriptResult.language, 'ru');
assert.strictEqual(transcriptResult.text, 'Всем привет! Сегодня мы поговорим о банковских картах.');
assert.strictEqual(transcriptResult.segments.length, 2);

console.log('✓ Test 6 passed: getVideoTranscript performs complete pipeline extraction');
passedTests++;

console.log(`\n🎉 ALL ${passedTests} TRANSCRIPT TESTS PASSED SUCCESSFULLY! 🎉`);

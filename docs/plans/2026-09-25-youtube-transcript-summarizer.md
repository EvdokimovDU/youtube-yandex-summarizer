# YouTube Video Transcript Extraction & Rich Summarization Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Extract full subtitles/transcripts directly from YouTube videos with automatic fallback to Yandex speech-recognition chapters, fix the Yandex text API polling loop so it collects all 6–8 rich executive theses, and bump the version to `1.0.2`.

**Architecture:**
- A new modular client `src/summarizer/api/transcript.js` parses YouTube's native `captionTracks` from the player response and fetches `timedtext?fmt=json3`, reconstructing clean spoken text.
- `src/summarizer/api/client.js` fixes the text generation polling loop to wait until completion (`status_code === 2 || 0`), preventing premature cutoff on chunk 1.
- In `summarizeVideo`, Stage 2 tries the full transcript first for rich depth; if subtitles are unavailable, it falls back to summarizing Yandex's video chapters. In both cases, YandexGPT produces 6–8 high-fidelity theses.
- All code is bundled via `scripts/build-summarizer.js` with version bumped to `1.0.2` and tested thoroughly.

**Tech Stack:** Vanilla JavaScript (ES2022), Web Crypto API, YouTube TimedText API (json3), Yandex 300 / NeuroAPI, Node.js test runner.

---

### Task 1: Fix Yandex Text Polling Loop in API Client

**Files:**
- Modify: `src/summarizer/api/client.js`
- Test: `tests/test-summarizer-api.js`

**Step 1.1:** Update `summarizeText` in `src/summarizer/api/client.js`:
- In the polling loop, do NOT exit when `status_code === 1` just because `data.thesis` has items.
- Only exit when `status_code === 2 || status_code === 0` (or `status_code === 2` with thesis array).
- Pass progress with current thesis count to `onProgress`.
- On completion, return all thesis items.

**Step 1.2:** Update `tests/test-summarizer-api.js`:
- Test mock polling where poll #1 has status 1 and 1 thesis, poll #2 has status 1 and 3 theses, poll #3 has status 2 and 6 theses.
- Verify `summarizeText` waits until status 2 and returns all 6 theses.
- Run `node tests/test-summarizer-api.js` and verify all tests pass.

---

### Task 2: Implement YouTube Transcript Extractor

**Files:**
- Create: `src/summarizer/api/transcript.js`
- Create: `tests/test-summarizer-transcript.js`

**Step 2.1:** Implement `src/summarizer/api/transcript.js`:
- `selectBestCaptionTrack(tracks)`: Prioritize `ru` manual > `ru` ASR > `en` manual > `en` ASR > any.
- `parseTimedTextEvents(json3Data)`: Reconstruct clean text from `events[].segs[].utf8`.
- `fetchTranscript(trackUrl, { fetchFn, signal, maxChars })`: Fetch `fmt=json3` and return transcript.
- `getPlayerCaptions(context)`: Extract tracks from `window.ytInitialPlayerResponse`, `document.querySelector('ytd-watch-flexy')?.playerData`, etc.
- `getVideoTranscript(videoId, options)`: End-to-end transcript extraction helper.

**Step 2.2:** Write `tests/test-summarizer-transcript.js`:
- Test `selectBestCaptionTrack` with various track lists (ru, en, auto, manual).
- Test `parseTimedTextEvents` with sample YouTube json3 payload.
- Test length limit truncation at sentence/word boundary.
- Run `node tests/test-summarizer-transcript.js`.

---

### Task 3: Integrate Transcript Extraction with Fallback in Client & Observer

**Files:**
- Modify: `src/summarizer/api/client.js`
- Modify: `src/summarizer/ui/observer.js`

**Step 3.1:** In `src/summarizer/api/client.js`:
- Import transcript utilities.
- In `summarizeVideo`, accept optional `transcriptText` or extract via `getVideoTranscript`.
- If transcript text exists (> 100 chars), call `summarizeText(transcriptText)`.
- If transcript fails or is absent, fall back to `combinedTheses`.
- Store `transcriptLanguage` and `overallTheses` in result.

**Step 3.2:** In `src/summarizer/ui/observer.js`:
- Pass browser context (`window`, `document`) into `summarizer.summarizeVideo` to allow accessing `ytInitialPlayerResponse`.

---

### Task 4: Version Bump to 1.0.2, Build & End-to-End Test

**Files:**
- Modify: `package.json` (version -> 1.0.2)
- Modify: `scripts/build-summarizer.js` (add `api/transcript.js` to `MODULE_FILES`, version -> 1.0.2)
- Modify: `tests/test-summarizer-bundle.js` (update version assertion to 1.0.2)
- Modify: `README.md` (document transcript extraction and version 1.0.2)

**Step 4.1:** Update version to `1.0.2` across files and update build configuration.
**Step 4.2:** Run `node scripts/build-summarizer.js` to regenerate `youtube-yandex-summarizer.user.js` and `dist/`.
**Step 4.3:** Run `npm test` to verify all test suites pass.

---

### Task 5: Git Commit, Push & User Notification

**Files:**
- Stage only relevant files.
- Commit message: `feat: extract YouTube video transcripts for rich 6-8 bullet summarization and bump to 1.0.2`.
- Push to GitHub `origin main`.
- Guide user on updating in Opera Tampermonkey.

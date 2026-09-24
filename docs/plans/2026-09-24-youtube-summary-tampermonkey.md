# YouTube Video Summarization Tampermonkey Extension Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Create a lightweight, high-performance Tampermonkey userscript that adds an AI-powered YouTube video summarization button and interactive panel (with keypoints, clickable timecodes, and bullet points) powered by Yandex's neural network API reverse-engineered from Yandex Browser and VOT.

**Architecture:** A standalone userscript (`youtube-yandex-summarizer.user.js`) implementing native lightweight Protobuf encoding/decoding for Yandex sessions, Web Crypto HMAC-SHA256 signature generation, an asynchronous polling client against `https://300.ya.ru/api/neuro/generation`, an in-memory & local cache for instant retrieval, and a seamless YouTube DOM integration controller rendering an accessible, modern UI panel with seek-on-click timecodes.

**Tech Stack:** JavaScript (ES2022+), Tampermonkey API (`GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`, `GM_addStyle`), Web Crypto API (`crypto.subtle`), Protobuf wire-format (vanilla zero-dependency).

---

## Technical Discovery: Yandex & VOT Interaction Architecture

Based on deep reverse-engineering of `ilyhalight/voice-over-translation` and `@vot.js`:

1. **Host & Modules:**
   - Auth & Sessions: `https://api.browser.yandex.ru/session/create`
   - Summarization API: `https://300.ya.ru/api/neuro/generation`
   - HMAC Secret: `"bt8xH3VOlb4mqf0nqAibnDOoiPlXsisf"`
   - Component Version: `"26.8.3.1002"`, Chromium Revision: `"1002"`

2. **Session Generation:**
   - Generate random 32-hex uppercase UUID.
   - Protobuf `YandexSessionRequest`: `uuid` (field 1, string), `module: "neuroapi"` (field 2, string).
   - HMAC-SHA256 signature of request body with the secret key.
   - Header: `Vtrans-Signature: <hex_digest>`.
   - Response: Protobuf `YandexSessionResponse` containing `secretKey` and `expires` (~3600s).

3. **Request Signing for Summarization:**
   - Path: `/api/neuro/generation`
   - Token payload: `${uuid}:${path}:${componentVersion}`
   - Token signature: `HMAC_SHA256(tokenPayload, secretKey)`
   - Headers:
     - `X-Ya-Summary-Token: ${tokenSign}:${tokenPayload}`
     - `X-Ya-Summary-Sk: ${secretKey}`
     - `X-Neuro-Page: yes`
     - `Content-Type: application/json`

4. **Lifecycle & Response Schema:**
   - Initial Request: POST `{"video_url": "https://www.youtube.com/watch?v=...", "type": "video"}`
   - Polling loop: While `status_code === 1` (in progress), wait `poll_interval_ms` and POST `{"session_id": sessionId, "type": "video"}`.
   - Finished state: `status_code === 0` returning:
     - `keypoints`: Array of chapters with `start_time` (seconds), `content` (chapter title), `theses` (array of bullet items `{ content }`).

---

## Implementation Tasks

### Task 1: Protocol & Cryptography Core
**Files:**
- Create: `src/core/crypto.js`
- Create: `src/core/session.js`
- Test: `tests/test-session.js`

**Step 1: Write session & crypto verification script**
Create unit test in `tests/test-session.js` validating HMAC-SHA256 signature generation and session creation against `api.browser.yandex.ru`.

**Step 2: Run test to verify it succeeds**
Run: `node tests/test-session.js`
Expected: Successfully obtains session with valid `secretKey` and `expires`.

**Step 3: Implement minimal standalone session generator**
Implement zero-dependency protobuf encoder/decoder and Web Crypto HMAC signer.

**Step 4: Commit**
`git add src/core/ tests/ && git commit -m "feat: add yandex session and crypto core"`

---

### Task 2: Yandex Summarization API Client
**Files:**
- Create: `src/api/summarizer.js`
- Test: `tests/test-summarizer.js`

**Step 1: Write test for video summarization polling**
Test fetching summarization for a known YouTube video (e.g. `https://www.youtube.com/watch?v=dQw4w9WgXcQ`), asserting status transitions from 1 to 0 and receiving valid `keypoints`.

**Step 2: Run test to verify API flow**
Run: `node tests/test-summarizer.js`
Expected: Returns JSON with chapters, timestamps, and bullet points.

**Step 3: Implement `YandexVideoSummarizer` client**
Build error handling (unsupported video, streams, rate limits, network timeouts), session caching, and polling orchestration.

**Step 4: Commit**
`git add src/api/ tests/ && git commit -m "feat: implement yandex video summarizer client"`

---

### Task 3: YouTube UI Controller & DOM Injection
**Files:**
- Create: `src/ui/styles.js`
- Create: `src/ui/panel.js`
- Create: `src/ui/button.js`
- Create: `src/observer.js`

**Step 1: Design responsive YouTube UI components**
- Summarize button injected into YouTube action bar (below video, next to Like/Share) matching YouTube's native SVG icon buttons and dark/light mode styles.
- Floating/docked draggable or collapsible panel displaying:
  - Video title & badge ("Нейропересказ YandexGPT")
  - Copy all text button
  - List of chapters with clickable timestamps (`MM:SS` / `HH:MM:SS`) that control the `<video>` player: `video.currentTime = start_time; video.play();`
  - Bullet list of key insights per chapter
  - Loading skeleton / spinner and error retry view.

**Step 2: Implement YouTube Single Page Navigation (SPA) Observer**
Watch for `yt-navigate-finish`, `spfdone`, and URL changes so buttons re-anchor and summaries reset properly when navigating between videos.

**Step 3: Commit**
`git add src/ui/ src/observer.js && git commit -m "feat: implement youtube ui and navigation observer"`

---

### Task 4: Standalone Userscript Assembly & Build Pipeline
**Files:**
- Create: `scripts/build.js`
- Create: `dist/youtube-yandex-summarizer.user.js`
- Modify: `package.json`

**Step 1: Create builder script**
Combine userscript metadata header (`// ==UserScript==`, `@match *://*.youtube.com/*`, `@grant GM_xmlhttpRequest`, `@grant GM_setValue`, `@grant GM_getValue`, etc.) with modular code into a single production `.user.js` file.

**Step 2: Build and verify distribution file**
Run: `node scripts/build.js`
Expected: Produces `dist/youtube-yandex-summarizer.user.js`.

**Step 3: Commit**
`git add scripts/ dist/ && git commit -m "feat: add build script and generate userscript"`

---

### Task 5: End-to-End Verification & Documentation
**Files:**
- Create: `README-summarizer.md`

**Step 1: Verify in browser environment**
Validate script headers, CSP compatibility, `GM_xmlhttpRequest` fallback, and player timecode jumping.

**Step 2: Write documentation**
Document installation guide for Tampermonkey / Violentmonkey / Violentmonkey on Chrome/Firefox/Edge.

**Step 3: Commit**
`git add README-summarizer.md && git commit -m "docs: add userscript installation and usage guide"`

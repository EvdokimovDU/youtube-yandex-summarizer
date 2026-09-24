# Executive Summary Overview & Version 1.0.1 Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a high-level executive summary overview (TL;DR block) above the chapters in the YouTube Video Summarizer drawer panel powered by YandexGPT text summarization API, and increment the project version to `1.0.1` across all metadata, files, and bundles.

**Architecture:** Two-stage summarization pipeline. Stage 1 immediately renders the chapters and timecodes (`type: "video"`). Stage 2 in background synthesizes all chapter theses, sends them to Yandex API (`type: "text"`), and renders a sleek, collapsible "Главное из видео" card at the top. Everything is cached together under the video ID.

**Tech Stack:** JavaScript (ES modules + IIFE bundle), Web Crypto API (HMAC-SHA256), Yandex 300 API (`/api/neuro/generation`), DOMParser / Trusted Types, Tampermonkey API (`GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`).

---

### Task 1: Extend Yandex API Client for Text / Overview Summarization

**Files:**
- Modify: `src/summarizer/api/client.js`
- Test: `tests/test-summarizer-api.js`

**Step 1: Write unit test for `summarizeText` and two-stage `summarizeVideo`**
Add tests to verify:
1. `summarizeText(text)` calls `/api/neuro/generation` with `type: "text"` and parses `thesis` array.
2. `summarizeVideo(url, { onProgress, onChaptersReady })` returns both `keypoints` (chapters) and `overallTheses` (high-level takeaway points).

**Step 2: Run test to verify it fails**
Run: `node tests/test-summarizer-api.js`
Expected: FAIL due to missing `summarizeText` / `overallTheses`.

**Step 3: Implement `summarizeText` and integrate into `YandexVideoSummarizer`**
- In `src/summarizer/api/client.js`:
  - Add `async summarizeText(text, { signal, onProgress } = {})`:
    - Validates text input (minimum length check).
    - Obtains session from `sessionManager.getSession('neuroapi')`.
    - Generates security headers with `getSecYaHeaders("Ya-Summary", session, "/api/neuro/generation")`.
    - POSTs `{ text, type: "text" }` to `300.ya.ru/api/neuro/generation`.
    - Polls until status 0 or 2 (success in text mode).
    - Extracts `(data.thesis || []).map(t => t.content)`.
  - In `summarizeVideo(urlOrId, { signal, onProgress, onChaptersReady } = {})`:
    - Checks cache: if cache has `overallTheses`, return immediately.
    - Resolves chapters (`keypoints`).
    - If `onChaptersReady`, invoke it with `{ videoId, title, keypoints }`.
    - Concatenates chapter titles and theses into a coherent summary prompt.
    - Calls `summarizeText(combinedTheses)`.
    - Stores `{ videoId, title, sharingUrl, keypoints, overallTheses }` in cache.
    - Graceful fallback: if `summarizeText` fails, fallback to extracting main bullet points from chapter titles without throwing error.

**Step 4: Run test to verify it passes**
Run: `node tests/test-summarizer-api.js`
Expected: PASS all tests including new summarization tests.

---

### Task 2: UI Drawer Overview Card & Copy Formatting

**Files:**
- Modify: `src/summarizer/ui/styles.js`
- Modify: `src/summarizer/ui/panel.js`
- Modify: `src/summarizer/ui/observer.js`
- Test: `tests/test-summarizer-ui.js`

**Step 1: Add Overview Component CSS in `src/summarizer/ui/styles.js`**
- Add styles for:
  - `.yt-summary-overview-card`: styled card with subtle accent border, background, rounded corners (10px), margin-bottom.
  - `.yt-summary-overview-header`: title with sparkles icon, badge "ГЛАВНОЕ" / "ИТОГ", and collapse toggle button.
  - `.yt-summary-overview-list`: clean bulleted list for top takeaways.
  - `.yt-summary-overview-skeleton`: animated pulsing shimmer while summary is generating in the background.

**Step 2: Update `SummaryDrawerPanel` in `src/summarizer/ui/panel.js`**
- Method `renderSummary(summaryData, onTimecodeClick)`:
  - Renders top `.yt-summary-overview-card`.
  - If `summaryData.overallTheses` is present, render the bullet points.
  - If `summaryData.isOverviewLoading`, render skeleton shimmer in the card.
  - Below, render the existing chapter cards with timestamps.
- Method `updateOverview(theses)`:
  - Dynamically updates the top overview card when background stage 2 completes without re-rendering or disrupting chapters.
- Update `copyFullText()`:
  - Formats both the executive summary bullets and the chapter-by-chapter timestamps into the clipboard.

**Step 3: Update `YouTubeController` in `src/summarizer/ui/observer.js`**
- Connect two-stage rendering:
  - Pass `onChaptersReady` to immediately render chapters.
  - When full summary completes, call `panel.updateOverview(overallTheses)`.

**Step 4: Run UI tests to verify**
Run: `node tests/test-summarizer-ui.js`
Expected: PASS all 7+ UI tests.

---

### Task 3: Version Bump to 1.0.1, Rebuild Bundle & Full Verification

**Files:**
- Modify: `package.json` (`version`: "1.0.1")
- Modify: `src/summarizer/` (ensure any version constants updated)
- Modify: `scripts/build-summarizer.js` (header `@version 1.0.1`)
- Generate: `youtube-yandex-summarizer.user.js` and `dist/youtube-yandex-summarizer.user.js`
- Test: `tests/test-summarizer-bundle.js`

**Step 1: Bump version to 1.0.1**
- Update `package.json`: `"version": "1.0.1"`.
- Update userscript headers in build script and root user.js: `// @version 1.0.1`.

**Step 2: Run build script**
Run: `node scripts/build-summarizer.js`
Expected: Successfully generates both bundle files with version 1.0.1.

**Step 3: Run full automated test suite**
Run: `npm test`
Expected: All 4 test suites pass (session, api, ui, bundle).

---

### Task 4: Push to GitHub and Verify in Opera

**Files:**
- Commit: All updated project files and bundles.

**Step 1: Commit and push to main**
```bash
git add package.json src/ dist/ tests/ youtube-yandex-summarizer.user.js docs/plans/
git commit -m "feat: add executive summary overview block and bump version to 1.0.1"
git push origin main
```

**Step 2: Verification**
- Verify GitHub raw link serves version 1.0.1.
- Provide user with quick update instructions.

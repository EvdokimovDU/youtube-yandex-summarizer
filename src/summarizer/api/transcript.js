/**
 * YouTube Transcript & Subtitles Extractor
 * Extracts spoken text from YouTube videos via native TimedText API (fmt=json3)
 * with intelligent language prioritization and graceful fallbacks.
 */

/**
 * Selects the optimal subtitle track from YouTube's captionTracks list.
 * Priority: Russian (manual) -> Russian (auto-generated) -> English (manual) -> English (auto) -> First available.
 *
 * @param {Array<{ baseUrl: string, languageCode: string, kind?: string, name?: { runs?: Array<{ text: string }> } }>} tracks
 * @returns {object|null} Best caption track or null if no tracks exist
 */
export function selectBestCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  // 1. Russian manual subtitles
  const ruManual = tracks.find(t => t.languageCode === 'ru' && t.kind !== 'asr');
  if (ruManual) return ruManual;

  // 2. Russian auto-generated (ASR)
  const ruAsr = tracks.find(t => t.languageCode === 'ru');
  if (ruAsr) return ruAsr;

  // 3. English manual subtitles
  const enManual = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
  if (enManual) return enManual;

  // 4. English auto-generated (ASR)
  const enAsr = tracks.find(t => t.languageCode === 'en');
  if (enAsr) return enAsr;

  // 5. Any manual subtitle track
  const anyManual = tracks.find(t => t.kind !== 'asr');
  if (anyManual) return anyManual;

  // 6. First track
  return tracks[0] || null;
}

/**
 * Decodes basic HTML entities common in subtitle text.
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

/**
 * Parses YouTube timedtext json3 format into continuous text and time-stamped segments.
 *
 * @param {object} json3
 * @returns {{ fullText: string, segments: Array<{ text: string, startMs: number, durationMs: number }> }}
 */
export function parseTimedTextEvents(json3) {
  if (!json3 || !Array.isArray(json3.events)) {
    return { fullText: '', segments: [] };
  }

  const segments = [];
  const textParts = [];

  for (const event of json3.events) {
    if (!Array.isArray(event.segs) || event.segs.length === 0) {
      continue;
    }

    const segText = event.segs
      .map(s => s?.utf8 || '')
      .join('')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    const cleanText = decodeHtmlEntities(segText);

    if (cleanText) {
      segments.push({
        text: cleanText,
        startMs: Number(event.tStartMs) || 0,
        durationMs: Number(event.dDurationMs) || 0
      });
      textParts.push(cleanText);
    }
  }

  // Join and normalize whitespace
  let fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();

  return { fullText, segments };
}

/**
 * Truncates text at sentence or word boundary to stay within token / character budgets.
 *
 * @param {string} text
 * @param {number} [maxChars=25000]
 * @returns {string}
 */
export function truncateTranscriptText(text, maxChars = 25000) {
  if (!text || text.length <= maxChars) {
    return text || '';
  }

  const slice = text.slice(0, maxChars);
  const searchWindow = Math.min(500, slice.length);
  const searchSlice = slice.slice(-searchWindow);
  const lastSentenceMatch = searchSlice.search(/[.!?]\s+[A-ZА-Я0-9]/i);
  if (lastSentenceMatch !== -1) {
    const cutoff = slice.length - searchWindow + lastSentenceMatch + 1;
    return slice.slice(0, cutoff).trim();
  }

  // Otherwise cut at last space
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.7) {
    return slice.slice(0, lastSpace).trim() + '...';
  }

  return slice.trim() + '...';
}

/**
 * Extracts player captions track list from the available browser / player context.
 *
 * @param {object} [context={}]
 * @returns {Array<object>|null}
 */
export function extractPlayerCaptions(context = {}) {
  // 1. Direct player response in options
  if (context.playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
    return context.playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
  }

  // 2. Global window / unsafeWindow objects
  const win = context.window || (typeof window !== 'undefined' ? window : null);
  const unsafeWin = context.unsafeWindow || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null);

  for (const w of [unsafeWin, win]) {
    if (!w) continue;
    const pr = w.ytInitialPlayerResponse;
    if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      return pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    }
  }

  // 3. YouTube DOM component playerData
  const doc = context.document || (typeof document !== 'undefined' ? document : null);
  if (doc?.querySelector) {
    const flexy = doc.querySelector('ytd-watch-flexy');
    const tracks = flexy?.playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks;
    }
  }

  return null;
}

/**
 * Fetches transcript text from a YouTube timedtext caption track URL.
 *
 * @param {string} trackUrl
 * @param {{
 *   fetchFn?: typeof fetch,
 *   signal?: AbortSignal,
 *   maxChars?: number
 * }} [options={}]
 * @returns {Promise<{ fullText: string, segments: Array<object> }|null>}
 */
export function fetchTranscriptFromUrl(trackUrl, { fetchFn = globalThis.fetch, signal, maxChars = 25000 } = {}) {
  if (!trackUrl || typeof trackUrl !== 'string') {
    return Promise.resolve(null);
  }

  let fullUrl = trackUrl;
  if (!fullUrl.includes('fmt=json3')) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'fmt=json3';
  }

  return fetchFn(fullUrl, { signal })
    .then(res => {
      if (!res.ok) {
        throw new Error(`Failed to fetch timedtext: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      const parsed = parseTimedTextEvents(data);
      if (!parsed.fullText) {
        return null;
      }
      parsed.fullText = truncateTranscriptText(parsed.fullText, maxChars);
      return parsed;
    })
    .catch(() => null);
}

/**
 * High-level helper: extracts transcript text for the current YouTube video.
 *
 * @param {string} videoId
 * @param {{
 *   context?: object,
 *   fetchFn?: typeof fetch,
 *   signal?: AbortSignal,
 *   maxChars?: number
 * }} [options={}]
 * @returns {Promise<{ text: string, language: string, isAsr: boolean, segments: Array<object> }|null>}
 */
export async function getVideoTranscript(videoId, { context = {}, fetchFn = globalThis.fetch, signal, maxChars = 25000 } = {}) {
  try {
    const tracks = extractPlayerCaptions(context);
    if (!tracks || tracks.length === 0) {
      return null;
    }

    const bestTrack = selectBestCaptionTrack(tracks);
    if (!bestTrack?.baseUrl) {
      return null;
    }

    const result = await fetchTranscriptFromUrl(bestTrack.baseUrl, { fetchFn, signal, maxChars });
    if (!result || !result.fullText) {
      return null;
    }

    return {
      text: result.fullText,
      language: bestTrack.languageCode || 'unknown',
      isAsr: bestTrack.kind === 'asr',
      segments: result.segments
    };
  } catch (_) {
    return null;
  }
}

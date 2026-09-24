/**
 * Yandex Video Summarizer API Client
 * Provides robust YouTube video ID extraction, timecode formatting, and polling-based summarization.
 */

import { YandexSessionManager } from '../core/session.js';
import { getSecYaHeaders } from '../core/crypto.js';
import { SummaryCache } from './cache.js';

/**
 * Extracts standard 11-character YouTube video ID from various URL formats or raw ID.
 * Supports:
 * - youtube.com/watch?v=ID
 * - youtu.be/ID
 * - youtube.com/embed/ID
 * - youtube.com/shorts/ID
 * - youtube.com/live/ID
 * - Raw 11-char ID
 *
 * @param {string} url
 * @returns {string | null} 11-char video ID or null if invalid
 */
export function extractYouTubeVideoId(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Direct 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // URL matching
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:[^&]*&)*v=))([a-zA-Z0-9_-]{11})(?=$|[?&#/])/i
  );

  return match ? match[1] : null;
}

/**
 * Produces canonical YouTube watch URL from video ID.
 * @param {string} videoId
 * @returns {string}
 */
export function canonicalYouTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Converts seconds into formatted timecode (MM:SS or HH:MM:SS).
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimecode(seconds) {
  const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * High-level client for Yandex 300.ya.ru neural video summarization API.
 */
export class YandexVideoSummarizer {
  /**
   * @param {{
   *   sessionManager?: YandexSessionManager,
   *   cache?: SummaryCache,
   *   fetchFn?: Function,
   *   baseUrl?: string
   * }} [options={}]
   */
  constructor({
    sessionManager,
    cache,
    fetchFn,
    baseUrl = "https://300.ya.ru"
  } = {}) {
    this.fetchFn = fetchFn || (typeof globalThis !== 'undefined' && globalThis.fetch ? globalThis.fetch.bind(globalThis) : null);
    this.sessionManager = sessionManager || new YandexSessionManager({ fetchFn: this.fetchFn });
    this.cache = cache || new SummaryCache();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Abort-aware sleep helper.
   * @private
   * @param {number} ms
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   */
  _sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error("Summarization request aborted");
        err.name = "AbortError";
        return reject(err);
      }

      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        const err = new Error("Summarization request aborted");
        err.name = "AbortError";
        reject(err);
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Requests summarization for a YouTube video and orchestrates polling.
   *
   * @param {string} urlOrId YouTube URL or video ID
   * @param {{
   *   signal?: AbortSignal,
   *   onProgress?: (progress: { status: string, statusCode: number, pollInterval?: number, approximateWaitingTime?: number }) => void
   * }} [options={}]
   * @returns {Promise<{
   *   videoId: string,
   *   title: string,
   *   sharingUrl: string,
   *   keypoints: Array<{ id: string|number, startTime: number, timecode: string, title: string, theses: string[] }>,
   *   raw: any,
   *   fromCache?: boolean
   * }>}
   */
  async summarizeVideo(urlOrId, { signal, onProgress } = {}) {
    if (signal?.aborted) {
      const err = new Error("Summarization request aborted");
      err.name = "AbortError";
      throw err;
    }

    const videoId = extractYouTubeVideoId(urlOrId);
    if (!videoId) {
      throw new Error("Invalid YouTube URL or Video ID");
    }

    // 1. Check Cache
    const cached = this.cache.get(videoId);
    if (cached) {
      if (typeof onChaptersReady === 'function') {
        try { onChaptersReady({ ...cached, fromCache: true }); } catch (_) {}
      }
      return { ...cached, fromCache: true };
    }

    if (!this.fetchFn) {
      throw new Error("No fetch implementation available in current environment");
    }

    // 2. Obtain session and security headers
    const session = await this.sessionManager.getSession("neuroapi");
    const secHeaders = await getSecYaHeaders("Ya-Summary", session, "/api/neuro/generation");
    const canonicalUrl = canonicalYouTubeUrl(videoId);

    // 3. Initial POST request
    const initialRes = await this.fetchFn(`${this.baseUrl}/api/neuro/generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Neuro-Page": "yes",
        ...secHeaders
      },
      body: JSON.stringify({ video_url: canonicalUrl, type: "video" }),
      signal
    });

    if (!initialRes.ok) {
      throw new Error(`Yandex API request failed (${initialRes.status} ${initialRes.statusText || ''})`);
    }

    let data = await initialRes.json();

    // 4. Polling loop (max 60 iterations)
    const MAX_POLL_ITERATIONS = 60;
    for (let iteration = 0; iteration < MAX_POLL_ITERATIONS; iteration++) {
      if (signal?.aborted) {
        const err = new Error("Summarization request aborted");
        err.name = "AbortError";
        throw err;
      }

      const statusCode = data.status_code;

      // Status 0: Success
      if (statusCode === 0) {
        const result = {
          videoId,
          title: data.title || "",
          sharingUrl: data.sharing_url || "",
          keypoints: (data.keypoints || []).map(kp => ({
            id: kp.id,
            startTime: kp.start_time ?? 0,
            timecode: formatTimecode(kp.start_time ?? 0),
            title: kp.content || kp.title || "",
            theses: (kp.theses || []).map(th => (typeof th === 'string' ? th : th?.content || ""))
          })),
          overallTheses: [],
          raw: data
        };

        // Notify caller that chapters are ready immediately (Stage 1 complete)
        if (typeof onChaptersReady === 'function') {
          try {
            onChaptersReady({ ...result });
          } catch (_) {}
        }

        // Stage 2: Generate overall executive summary from chapters/theses
        const combinedTheses = (result.keypoints || []).map(kp => {
          const thesesText = (kp.theses || []).join('. ');
          return kp.title ? `${kp.title}: ${thesesText}` : thesesText;
        }).filter(Boolean).join('\n');

        if (combinedTheses.length > 20) {
          try {
            const overall = await this.summarizeText(combinedTheses, { signal });
            if (Array.isArray(overall) && overall.length > 0) {
              result.overallTheses = overall;
            }
          } catch (_) {
            // Graceful fallback: extract first thesis from each chapter
            result.overallTheses = (result.keypoints || [])
              .map(kp => kp.theses[0] || kp.title)
              .filter(Boolean)
              .slice(0, 5);
          }
        }

        if (!result.overallTheses || result.overallTheses.length === 0) {
          result.overallTheses = (result.keypoints || [])
            .map(kp => kp.theses[0] || kp.title)
            .filter(Boolean)
            .slice(0, 5);
        }

        this.cache.set(videoId, result);
        return result;
      }

      // Status 1, 3, 4: In Progress
      if (statusCode === 1 || statusCode === 3 || statusCode === 4) {
        if (typeof onProgress === 'function') {
          onProgress({
            status: "progress",
            statusCode: data.status_code,
            pollInterval: data.poll_interval_ms,
            approximateWaitingTime: data.approximate_waiting_time
          });
        }

        const waitMs = data.poll_interval_ms || 1000;
        await this._sleep(waitMs, signal);

        if (signal?.aborted) {
          const err = new Error("Summarization request aborted");
          err.name = "AbortError";
          throw err;
        }

        const pollRes = await this.fetchFn(`${this.baseUrl}/api/neuro/generation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Neuro-Page": "yes"
          },
          body: JSON.stringify({ session_id: data.session_id, type: "video" }),
          signal
        });

        if (!pollRes.ok) {
          throw new Error(`Polling request failed (${pollRes.status} ${pollRes.statusText || ''})`);
        }

        data = await pollRes.json();
        continue;
      }

      // Status 2: Error
      if (statusCode === 2) {
        throw new Error(`Yandex API returned error (status 2): ${data.message || "Video cannot be summarized"}`);
      }

      throw new Error(`Unexpected status code received: ${statusCode} (${data.message || ''})`);
    }

    throw new Error("Summarization request timed out");
  }

  /**
   * Requests neural text summarization from Yandex 300 API.
   *
   * @param {string} text Plain text content to summarize
   * @param {{
   *   signal?: AbortSignal,
   *   onProgress?: (progress: { status: string, statusCode: number, pollInterval?: number, approximateWaitingTime?: number }) => void
   * }} [options={}]
   * @returns {Promise<string[]>} Array of high-level summary theses
   */
  async summarizeText(text, { signal, onProgress } = {}) {
    if (signal?.aborted) {
      const err = new Error("Text summarization request aborted");
      err.name = "AbortError";
      throw err;
    }

    const cleanText = (typeof text === 'string' ? text.trim() : '');
    if (!cleanText) {
      return [];
    }

    if (!this.fetchFn) {
      throw new Error("No fetch implementation available in current environment");
    }

    const session = await this.sessionManager.getSession("neuroapi");
    const secHeaders = await getSecYaHeaders("Ya-Summary", session, "/api/neuro/generation");

    const initialRes = await this.fetchFn(`${this.baseUrl}/api/neuro/generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Neuro-Page": "yes",
        ...secHeaders
      },
      body: JSON.stringify({ text: cleanText, type: "text" }),
      signal
    });

    if (!initialRes.ok) {
      throw new Error(`Yandex text summarization failed (${initialRes.status} ${initialRes.statusText || ''})`);
    }

    let data = await initialRes.json();

    const MAX_POLL_ITERATIONS = 60;
    for (let iteration = 0; iteration < MAX_POLL_ITERATIONS; iteration++) {
      if (signal?.aborted) {
        const err = new Error("Text summarization request aborted");
        err.name = "AbortError";
        throw err;
      }

      // Check for completed thesis array (Yandex text mode completes with status 0 or 2 with non-empty thesis)
      if (Array.isArray(data.thesis) && data.thesis.length > 0) {
        return data.thesis
          .map(t => (typeof t === 'string' ? t : t?.content || ""))
          .filter(Boolean);
      }

      // Status 0 without thesis array or empty
      if (data.status_code === 0) {
        if (Array.isArray(data.thesis)) {
          return data.thesis.map(t => (typeof t === 'string' ? t : t?.content || "")).filter(Boolean);
        }
        return [];
      }

      // Status 1, 3, 4: In Progress
      if (data.status_code === 1 || data.status_code === 3 || data.status_code === 4) {
        if (typeof onProgress === 'function') {
          onProgress({
            status: "progress",
            statusCode: data.status_code,
            pollInterval: data.poll_interval_ms,
            approximateWaitingTime: data.approximate_waiting_time
          });
        }

        const waitMs = data.poll_interval_ms || 1000;
        await this._sleep(waitMs, signal);

        if (signal?.aborted) {
          const err = new Error("Text summarization request aborted");
          err.name = "AbortError";
          throw err;
        }

        const pollRes = await this.fetchFn(`${this.baseUrl}/api/neuro/generation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Neuro-Page": "yes"
          },
          body: JSON.stringify({ session_id: data.session_id, type: "text" }),
          signal
        });

        if (!pollRes.ok) {
          throw new Error(`Text polling request failed (${pollRes.status} ${pollRes.statusText || ''})`);
        }

        data = await pollRes.json();
        continue;
      }

      // Status 2 with no thesis: Error
      if (data.status_code === 2) {
        throw new Error(`Yandex API returned error (status 2): ${data.message || "Text cannot be summarized"}`);
      }

      throw new Error(`Unexpected status code received: ${data.status_code} (${data.message || ''})`);
    }

    throw new Error("Text summarization request timed out");
  }
}

export default YandexVideoSummarizer;

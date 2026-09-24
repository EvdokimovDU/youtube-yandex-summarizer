// ==UserScript==
// @name         YouTube Video Summarizer (YandexGPT)
// @name:ru      Краткий пересказ видео YouTube (YandexGPT)
// @namespace    https://github.com/Antigravity/youtube-yandex-summarizer
// @version      1.0.3
// @description  AI-powered YouTube video summarization with keypoints and clickable timestamps using Yandex neural networks
// @description:ru Нейросетевой пересказ видео на YouTube с тезисами и кликабельными таймкодами (YandexGPT / 300.ya.ru)
// @author       Antigravity
// @match        *://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      300.ya.ru
// @connect      api.browser.yandex.ru
// @connect      www.youtube.com
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // Part 1: Protocol & Cryptography Core (core/crypto.js)
  // =========================================================================

  /**
   * Protocol and Cryptography Core for Yandex API
   * Web Crypto API implementation supporting both Node.js and Browser environments.
   */
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const HMAC_SECRET = "bt8xH3VOlb4mqf0nqAibnDOoiPlXsisf";
  const COMPONENT_VERSION = "26.8.3.1002";
  
  let cachedHmacKey = null;
  
  /**
   * Resolves the SubtleCrypto instance across environments (Browser, Node.js, Web Worker).
   * @returns {Promise<SubtleCrypto>}
   */
  async function getSubtleCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      return globalThis.crypto.subtle;
    }
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      return window.crypto.subtle;
    }
    // Node.js fallback for older or sandboxed environments
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.webcrypto.subtle;
  }
  
  /**
   * Signs a payload using HMAC-SHA256 and returns a lowercase hex string.
   * @param {Uint8Array | string} body 
   * @param {string} [secretKey=HMAC_SECRET]
   * @returns {Promise<string>}
   */
  async function getSignature(body, secretKey = HMAC_SECRET) {
    const subtle = await getSubtleCrypto();
    const data = typeof body === 'string' ? textEncoder.encode(body) : body;
  
    let key;
    if (secretKey === HMAC_SECRET && cachedHmacKey) {
      key = cachedHmacKey;
    } else {
      const keyData = typeof secretKey === 'string' ? textEncoder.encode(secretKey) : secretKey;
      key = await subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: { name: 'SHA-256' } },
        false,
        ['sign']
      );
      if (secretKey === HMAC_SECRET) {
        cachedHmacKey = key;
      }
    }
  
    const signatureBuffer = await subtle.sign('HMAC', key, data);
    const signatureBytes = new Uint8Array(signatureBuffer);
    return Array.from(signatureBytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  
  /**
   * Generates a 32-character random uppercase hexadecimal string.
   * @returns {string}
   */
  function getUUID() {
    const bytes = new Uint8Array(16);
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  
  /**
   * Generates security headers required by Yandex services (Ya-Summary or Vtrans).
   * @param {'Ya-Summary' | 'Vtrans'} secType 
   * @param {{ uuid: string, secretKey: string }} session 
   * @param {string} path 
   * @returns {Promise<Record<string, string>>}
   */
  async function getSecYaHeaders(secType, session, path) {
    const componentVersion = COMPONENT_VERSION;
    const token = `${session.uuid}:${path}:${componentVersion}`;
    const tokenSign = await getSignature(token);
  
    if (secType === "Ya-Summary") {
      return {
        "X-Ya-Summary-Sk": session.secretKey,
        "X-Ya-Summary-Token": `${tokenSign}:${token}`
      };
    }
  
    if (secType === "Vtrans") {
      return {
        "Sec-Vtrans-Sk": session.secretKey,
        "Sec-Vtrans-Token": `${tokenSign}:${token}`
      };
    }
  
    throw new Error(`Unsupported security type: ${secType}`);
  }

  // =========================================================================
  // Part 2: Protobuf & Session Manager (core/session.js)
  // =========================================================================

  /**
   * Lightweight Zero-Dependency Protobuf & Yandex Session Manager
   */
  
  /**
   * Encodes an integer into Protobuf varint bytes.
   * @param {number} value
   * @returns {number[]}
   */
  function encodeVarint(value) {
    const bytes = [];
    let v = value;
    while (v > 127) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v & 0x7f);
    return bytes;
  }
  
  /**
   * Encodes session creation request into Protobuf wire format.
   * Schema:
   *   field 1 (0x0a): string uuid
   *   field 2 (0x12): string module
   * 
   * @param {string} uuid
   * @param {string} [module="neuroapi"]
   * @returns {Uint8Array}
   */
  function encodeSessionRequest(uuid, module = "neuroapi") {
    const uuidBytes = textEncoder.encode(uuid);
    const moduleBytes = textEncoder.encode(module);
  
    const uuidLenVarint = encodeVarint(uuidBytes.length);
    const moduleLenVarint = encodeVarint(moduleBytes.length);
  
    const totalLength = 1 + uuidLenVarint.length + uuidBytes.length +
                        1 + moduleLenVarint.length + moduleBytes.length;
  
    const result = new Uint8Array(totalLength);
    let offset = 0;
  
    // Field 1: tag 1, wire type 2 -> 0x0a
    result[offset++] = 0x0a;
    for (let i = 0; i < uuidLenVarint.length; i++) {
      result[offset++] = uuidLenVarint[i];
    }
    result.set(uuidBytes, offset);
    offset += uuidBytes.length;
  
    // Field 2: tag 2, wire type 2 -> 0x12
    result[offset++] = 0x12;
    for (let i = 0; i < moduleLenVarint.length; i++) {
      result[offset++] = moduleLenVarint[i];
    }
    result.set(moduleBytes, offset);
    offset += moduleBytes.length;
  
    return result;
  }
  
  /**
   * Decodes session creation response from Protobuf wire format.
   * Expects:
   *   field 1: string secretKey
   *   field 2: varint expires
   * 
   * @param {Uint8Array | ArrayBuffer} rawBytes
   * @returns {{ secretKey: string, expires: number }}
   */
  function decodeSessionResponse(rawBytes) {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    let offset = 0;
    let secretKey = '';
    let expires = 0;
  
    while (offset < bytes.length) {
      // Read tag varint
      let key = 0;
      let shift = 0;
      while (offset < bytes.length) {
        const b = bytes[offset++];
        key += (b & 0x7f) * Math.pow(2, shift);
        shift += 7;
        if ((b & 0x80) === 0) break;
      }
  
      const fieldNumber = Math.floor(key / 8);
      const wireType = key & 7;
  
      if (fieldNumber === 1 && wireType === 2) {
        // Length-delimited string secretKey
        let len = 0;
        let lenShift = 0;
        while (offset < bytes.length) {
          const b = bytes[offset++];
          len += (b & 0x7f) * Math.pow(2, lenShift);
          lenShift += 7;
          if ((b & 0x80) === 0) break;
        }
        const strSlice = bytes.subarray(offset, offset + len);
        secretKey = textDecoder.decode(strSlice);
        offset += len;
      } else if (fieldNumber === 2 && wireType === 0) {
        // Varint expires
        let val = 0;
        let valShift = 0;
        while (offset < bytes.length) {
          const b = bytes[offset++];
          val += (b & 0x7f) * Math.pow(2, valShift);
          valShift += 7;
          if ((b & 0x80) === 0) break;
        }
        expires = val;
      } else {
        // Skip unknown fields
        if (wireType === 0) {
          while (offset < bytes.length && (bytes[offset++] & 0x80) !== 0) {}
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 2) {
          let skipLen = 0;
          let sShift = 0;
          while (offset < bytes.length) {
            const b = bytes[offset++];
            skipLen += (b & 0x7f) * Math.pow(2, sShift);
            sShift += 7;
            if ((b & 0x80) === 0) break;
          }
          offset += skipLen;
        } else if (wireType === 5) {
          offset += 4;
        } else {
          break;
        }
      }
    }
  
    return { secretKey, expires };
  }
  
  /**
   * Manages Yandex API sessions with automatic in-memory caching and refreshing.
   */
  class YandexSessionManager {
    /**
     * @param {{ fetchFn?: Function, host?: string }} [options={}]
     */
    constructor({ fetchFn, host = "api.browser.yandex.ru" } = {}) {
      this.fetchFn = fetchFn || (typeof globalThis !== 'undefined' && globalThis.fetch ? globalThis.fetch.bind(globalThis) : null);
      this.host = host;
      this.sessions = new Map();
    }
  
    /**
     * Checks whether a session has not expired.
     * @param {{ secretKey?: string, expires?: number, timestamp?: number }} session
     * @returns {boolean}
     */
    isSessionValid(session) {
      if (!session || !session.secretKey) return false;
      const now = Date.now();
      const expiresMs = (session.expires || 0) * 1000;
      // 30 seconds safety margin to avoid edge cases
      return (session.timestamp + expiresMs) > (now + 30000);
    }
  
    /**
     * Creates a new session against Yandex API.
     * @param {string} [module="neuroapi"]
     * @returns {Promise<{ uuid: string, secretKey: string, expires: number, timestamp: number }>}
     */
    async createSession(module = "neuroapi") {
      if (!this.fetchFn) {
        throw new Error("No fetch implementation available in current environment");
      }
  
      const uuid = getUUID();
      const body = encodeSessionRequest(uuid, module);
      const signature = await getSignature(body);
  
      const url = `https://${this.host}/session/create`;
      const headers = {
        "Content-Type": "application/x-protobuf",
        "Accept": "application/x-protobuf",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36",
        "Vtrans-Signature": signature
      };
  
      const response = await this.fetchFn(url, {
        method: "POST",
        headers,
        body
      });
  
      if (!response.ok) {
        throw new Error(`Failed to create Yandex session (${response.status} ${response.statusText || ''})`);
      }
  
      const buffer = await response.arrayBuffer();
      const decoded = decodeSessionResponse(new Uint8Array(buffer));
  
      const session = {
        uuid,
        secretKey: decoded.secretKey,
        expires: decoded.expires,
        timestamp: Date.now()
      };
  
      this.sessions.set(module, session);
      return session;
    }
  
    /**
     * Retrieves an existing valid session from cache or creates a new one.
     * @param {string} [module="neuroapi"]
     * @returns {Promise<{ uuid: string, secretKey: string, expires: number, timestamp: number }>}
     */
    async getSession(module = "neuroapi") {
      const cached = this.sessions.get(module);
      if (this.isSessionValid(cached)) {
        return cached;
      }
      return this.createSession(module);
    }
  }

  // =========================================================================
  // Part 3: Video Summary Cache (api/cache.js)
  // =========================================================================

  /**
   * Video Summary In-Memory and Persistent Cache
   * Supports TTL and adapters for localStorage / Tampermonkey GM_getValue / GM_setValue.
   */
  const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const DEFAULT_KEY_PREFIX = 'ya_summary_';
  
  /**
   * Normalizes input key to videoId if a YouTube URL is provided.
   * @param {string} key
   * @returns {string}
   */
  function normalizeCacheKey(key) {
    if (typeof key !== 'string') return String(key || '');
    const trimmed = key.trim();
    const match = trimmed.match(
      /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:[^&]*&)*v=))([a-zA-Z0-9_-]{11})(?=$|[?&#/])/i
    );
    return match ? match[1] : trimmed;
  }
  class SummaryCache {
    /**
     * @param {{
     *   storage?: { get?: Function, set?: Function, delete?: Function, getItem?: Function, setItem?: Function, removeItem?: Function } | null,
     *   defaultTtlMs?: number,
     *   keyPrefix?: string
     * }} [options={}]
     */
    constructor({ storage = null, defaultTtlMs = DEFAULT_CACHE_TTL_MS, keyPrefix = DEFAULT_KEY_PREFIX } = {}) {
      this.memory = new Map();
      this.storage = storage;
      this.defaultTtl = defaultTtlMs;
      this.keyPrefix = keyPrefix;
    }
  
    /**
     * Formats a storage key with prefix.
     * @private
     * @param {string} videoId
     * @returns {string}
     */
    _getStorageKey(videoId) {
      return `${this.keyPrefix}${videoId}`;
    }
  
    /**
     * Safely reads raw value from storage adapter.
     * @private
     * @param {string} key
     * @returns {*}
     */
    _readStorage(key) {
      if (!this.storage) return null;
      try {
        if (typeof this.storage.get === 'function') {
          return this.storage.get(key);
        }
        if (typeof this.storage.getItem === 'function') {
          return this.storage.getItem(key);
        }
      } catch {
        return null;
      }
      return null;
    }
  
    /**
     * Safely writes raw value to storage adapter.
     * @private
     * @param {string} key
     * @param {*} value
     */
    _writeStorage(key, value) {
      if (!this.storage) return;
      try {
        if (typeof this.storage.set === 'function') {
          this.storage.set(key, value);
        } else if (typeof this.storage.setItem === 'function') {
          this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      } catch {
        // Ignore quota exceeded or storage errors
      }
    }
  
    /**
     * Safely removes key from storage adapter.
     * @private
     * @param {string} key
     */
    _deleteStorage(key) {
      if (!this.storage) return;
      try {
        if (typeof this.storage.delete === 'function') {
          this.storage.delete(key);
        } else if (typeof this.storage.removeItem === 'function') {
          this.storage.removeItem(key);
        }
      } catch {
        // Ignore storage errors
      }
    }
  
    /**
     * Retrieves an item from cache if present and unexpired.
     * @param {string} videoId
     * @returns {* | null} Cached data or null
     */
    get(videoId) {
      const id = normalizeCacheKey(videoId);
      if (!id) return null;
      const now = Date.now();
  
      // 1. Check in-memory cache
      const memRecord = this.memory.get(id);
      if (memRecord) {
        if (memRecord.expiresAt > now) {
          return memRecord.data;
        }
        // Expired in memory
        this.memory.delete(id);
        this._deleteStorage(this._getStorageKey(id));
        return null;
      }
  
      // 2. Check persistent storage adapter
      if (this.storage) {
        const storageKey = this._getStorageKey(id);
        let raw = this._readStorage(storageKey);
        if (raw) {
          let parsed = raw;
          if (typeof raw === 'string') {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
  
          if (parsed && typeof parsed === 'object' && 'expiresAt' in parsed && 'data' in parsed) {
            if (parsed.expiresAt > now) {
              // Restore to memory cache
              this.memory.set(id, parsed);
              return parsed.data;
            }
            // Expired in storage
            this._deleteStorage(storageKey);
          }
        }
      }
  
      return null;
    }
  
    /**
     * Saves data into in-memory and persistent cache.
     * @param {string} videoId
     * @param {*} data
     * @param {number} [ttlMs] Custom TTL in milliseconds
     * @returns {*} Stored data
     */
    set(videoId, data, ttlMs = this.defaultTtl) {
      const id = normalizeCacheKey(videoId);
      if (!id) return data;
      const effectiveTtl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this.defaultTtl;
      const expiresAt = Date.now() + effectiveTtl;
      const record = { data, expiresAt };
  
      this.memory.set(id, record);
  
      if (this.storage) {
        const storageKey = this._getStorageKey(id);
        this._writeStorage(storageKey, record);
      }
  
      return data;
    }
  
    /**
     * Checks if an unexpired item exists in cache.
     * @param {string} videoId
     * @returns {boolean}
     */
    has(videoId) {
      return this.get(videoId) !== null;
    }
  
    /**
     * Removes a specific item from memory and storage.
     * @param {string} videoId
     */
    delete(videoId) {
      const id = normalizeCacheKey(videoId);
      if (!id) return;
      this.memory.delete(id);
      this._deleteStorage(this._getStorageKey(id));
    }
  
    /**
     * Clears the entire in-memory cache and invokes clear on storage if available.
     */
    clear() {
      this.memory.clear();
      if (this.storage) {
        try {
          if (typeof this.storage.clear === 'function') {
            this.storage.clear();
          }
        } catch {
          // Ignore storage errors
        }
      }
    }
  }

  // =========================================================================
  // Part 4: YouTube Transcript & Subtitles Extractor (api/transcript.js)
  // =========================================================================

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
  function selectBestCaptionTrack(tracks) {
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
  function decodeHtmlEntities(str) {
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
  function parseTimedTextEvents(json3) {
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
   * @param {number} [maxChars=150000]
   * @returns {string}
   */
  function truncateTranscriptText(text, maxChars = 150000) {
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
  function extractPlayerCaptions(context = {}) {
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
  function fetchTranscriptFromUrl(trackUrl, { fetchFn = globalThis.fetch, signal, maxChars = 150000 } = {}) {
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
  async function getVideoTranscript(videoId, { context = {}, fetchFn = globalThis.fetch, signal, maxChars = 150000 } = {}) {
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

  // =========================================================================
  // Part 5: Yandex Video Summarizer Client (api/client.js)
  // =========================================================================

  /**
   * Yandex Video Summarizer API Client
   * Provides robust YouTube video ID extraction, timecode formatting, and polling-based summarization.
   */
  
  
  
  
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
  function extractYouTubeVideoId(url) {
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
  function canonicalYouTubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  
  /**
   * Converts seconds into formatted timecode (MM:SS or HH:MM:SS).
   * @param {number} seconds
   * @returns {string}
   */
  function formatTimecode(seconds) {
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
  class YandexVideoSummarizer {
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
    async summarizeVideo(urlOrId, { signal, onProgress, onChaptersReady, context } = {}) {
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
  
          // Stage 2: Generate rich overall executive summary (transcript first, chapters fallback)
          let overallThesesGenerated = false;
  
          // Try extracting YouTube transcript first
          try {
            const transcriptData = await getVideoTranscript(videoId, {
              context,
              fetchFn: this.fetchFn,
              signal,
              maxChars: 150000
            });
  
            if (transcriptData?.text && transcriptData.text.length > 30) {
              result.transcriptLanguage = transcriptData.language;
              result.isTranscriptAsr = transcriptData.isAsr;
              const overall = await this.summarizeText(transcriptData.text, { signal });
              if (Array.isArray(overall) && overall.length > 0) {
                result.overallTheses = overall;
                overallThesesGenerated = true;
              }
            }
          } catch (_) {}
  
          // Fallback: summarize combined chapter theses if transcript is unavailable or failed
          if (!overallThesesGenerated) {
            const combinedTheses = (result.keypoints || []).map(kp => {
              const thesesText = (kp.theses || []).join('. ');
              return kp.title ? `${kp.title}: ${thesesText}` : thesesText;
            }).filter(Boolean).join('\n');
  
            if (combinedTheses.length > 20) {
              try {
                const overall = await this.summarizeText(combinedTheses, { signal });
                if (Array.isArray(overall) && overall.length > 0) {
                  result.overallTheses = overall;
                  overallThesesGenerated = true;
                }
              } catch (_) {}
            }
          }
  
          // Final fallback: extract top thesis from each chapter (up to 8)
          if (!Array.isArray(result.overallTheses) || result.overallTheses.length === 0) {
            result.overallTheses = (result.keypoints || [])
              .map(kp => kp.theses[0] || kp.title)
              .filter(Boolean)
              .slice(0, 8);
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
  
        // Completed state:
        // In Yandex text mode, generation finishes either with status_code === 0 or status_code === 2 (when thesis array is populated).
        const hasTheses = Array.isArray(data.thesis) && data.thesis.length > 0;
        if (data.status_code === 0 || (data.status_code === 2 && hasTheses)) {
          if (hasTheses) {
            return data.thesis
              .map(t => (typeof t === 'string' ? t : t?.content || ""))
              .filter(Boolean);
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

  // =========================================================================
  // Part 6: UI Styles & Themes (ui/styles.js)
  // =========================================================================

  /**
   * CSS stylesheet and injection helper for YouTube Video Summarizer UI.
   * Adapts to YouTube dark and light themes seamlessly via CSS variables.
   */
  const UI_STYLES = `
  /* ==========================================================================
     YouTube Summarizer Component Styles & Theme Variables
     ========================================================================== */
  
  :root {
    --yts-bg: var(--yt-spec-base-background, #0f0f0f);
    --yts-surface: var(--yt-spec-raised-background, #212121);
    --yts-surface-hover: rgba(255, 255, 255, 0.1);
    --yts-border: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.12));
    --yts-text-primary: var(--yt-spec-text-primary, #f1f1f1);
    --yts-text-secondary: var(--yt-spec-text-secondary, #aaaaaa);
    --yts-badge-bg: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.08));
    --yts-badge-text: #fc3f1d;
    --yts-btn-bg: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1));
    --yts-btn-hover: rgba(255, 255, 255, 0.18);
    --yts-btn-active: rgba(252, 63, 29, 0.22);
    --yts-accent: #fc3f1d;
    --yts-accent-hover: #ff5233;
    --yts-timecode-bg: rgba(252, 63, 29, 0.14);
    --yts-timecode-hover: rgba(252, 63, 29, 0.28);
    --yts-timecode-text: #ff6e4e;
    --yts-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    --yts-radius: 14px;
  }
  
  html:not([dark]) {
    --yts-bg: var(--yt-spec-base-background, #ffffff);
    --yts-surface: var(--yt-spec-raised-background, #f9f9f9);
    --yts-surface-hover: rgba(0, 0, 0, 0.06);
    --yts-border: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
    --yts-text-primary: var(--yt-spec-text-primary, #0f0f0f);
    --yts-text-secondary: var(--yt-spec-text-secondary, #606060);
    --yts-badge-bg: rgba(252, 63, 29, 0.08);
    --yts-badge-text: #d32305;
    --yts-btn-bg: rgba(0, 0, 0, 0.05);
    --yts-btn-hover: rgba(0, 0, 0, 0.1);
    --yts-btn-active: rgba(252, 63, 29, 0.15);
    --yts-timecode-bg: rgba(252, 63, 29, 0.1);
    --yts-timecode-hover: rgba(252, 63, 29, 0.2);
    --yts-timecode-text: #d32305;
    --yts-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  
  /* ==========================================================================
     Action Bar Button (.yt-summary-btn)
     Matches native YouTube pill action buttons
     ========================================================================== */
  
  .yt-summary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    font-family: "Roboto", "Segoe UI", Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    line-height: 36px;
    color: var(--yts-text-primary);
    background-color: var(--yts-btn-bg);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    box-sizing: border-box;
    outline: none;
    user-select: none;
    vertical-align: middle;
    margin-right: 8px;
    flex-shrink: 0;
  }
  
  .yt-summary-btn:hover {
    background-color: var(--yts-btn-hover);
  }
  
  .yt-summary-btn:active {
    transform: scale(0.97);
  }
  
  .yt-summary-btn.active {
    background-color: var(--yts-btn-active);
    border-color: rgba(252, 63, 29, 0.4);
    color: var(--yts-accent);
  }
  
  .yt-summary-btn.loading {
    opacity: 0.8;
    cursor: wait;
  }
  
  .yt-summary-btn svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
    flex-shrink: 0;
  }
  
  .yt-summary-btn.loading svg {
    animation: yts-spin 1.1s linear infinite;
  }
  
  /* ==========================================================================
     Sidebar Drawer Panel (.yt-summary-drawer)
     ========================================================================== */
  
  .yt-summary-drawer {
    position: fixed;
    top: 56px;
    bottom: 12px;
    right: 16px;
    width: 380px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 68px);
    background-color: var(--yts-surface);
    color: var(--yts-text-primary);
    border: 1px solid var(--yts-border);
    border-radius: var(--yts-radius);
    box-shadow: var(--yts-shadow);
    display: flex;
    flex-direction: column;
    z-index: 2200;
    overflow: hidden;
    transform: translateX(calc(100% + 30px));
    opacity: 0;
    pointer-events: none;
    transition: transform 0.28s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.25s ease;
    backdrop-filter: blur(12px);
    box-sizing: border-box;
    font-family: "Roboto", "Segoe UI", Arial, sans-serif;
  }
  
  .yt-summary-drawer.open {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }
  
  /* Header */
  .yt-summary-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 12px 16px;
    border-bottom: 1px solid var(--yts-border);
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
    background-color: rgba(255, 255, 255, 0.02);
  }
  
  .yt-summary-drawer-header:active {
    cursor: grabbing;
  }
  
  .yt-summary-header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--yts-text-primary);
  }
  
  .yt-summary-header-title svg {
    width: 18px;
    height: 18px;
    fill: var(--yts-accent);
  }
  
  .yt-summary-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--yts-badge-text);
    background-color: var(--yts-badge-bg);
    border: 1px solid rgba(252, 63, 29, 0.25);
    text-transform: uppercase;
  }
  
  .yt-summary-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .yt-summary-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 16px;
    background: transparent;
    border: none;
    color: var(--yts-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
    outline: none;
  }
  
  .yt-summary-icon-btn:hover {
    background-color: var(--yts-surface-hover);
    color: var(--yts-text-primary);
  }
  
  .yt-summary-icon-btn svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  
  .yt-summary-icon-btn.copied::after {
    content: "Скопировано!";
    position: absolute;
    bottom: -28px;
    right: 0;
    background: #111;
    color: #fff;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
    z-index: 10;
    animation: yts-fade-in 0.2s ease forwards;
  }
  
  /* Drawer Content Area */
  .yt-summary-drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--yts-border) transparent;
  }
  
  .yt-summary-drawer-content::-webkit-scrollbar {
    width: 6px;
  }
  
  .yt-summary-drawer-content::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .yt-summary-drawer-content::-webkit-scrollbar-thumb {
    background-color: var(--yts-border);
    border-radius: 3px;
  }
  
  /* Video Title in drawer */
  .yt-summary-video-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--yts-text-primary);
    line-height: 1.4;
    margin-bottom: 4px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--yts-border);
  }
  
  /* ==========================================================================
     Executive Summary Overview Card (.yt-summary-overview-card)
     ========================================================================== */
  
  .yt-summary-overview-card {
    background: linear-gradient(135deg, rgba(252, 63, 29, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%);
    border: 1px solid rgba(252, 63, 29, 0.25);
    border-left: 3px solid var(--yts-accent);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 6px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: all 0.2s ease;
  }
  
  .yt-summary-overview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
  }
  
  .yt-summary-overview-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    font-weight: 700;
    color: var(--yts-text-primary);
    letter-spacing: 0.2px;
  }
  
  .yt-summary-overview-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background-color: var(--yts-accent);
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .yt-summary-overview-toggle {
    background: none;
    border: none;
    color: var(--yts-text-secondary);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease, transform 0.2s ease;
  }
  
  .yt-summary-overview-toggle:hover {
    color: var(--yts-text-primary);
  }
  
  .yt-summary-overview-toggle svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
    transition: transform 0.2s ease;
  }
  
  .yt-summary-overview-card.collapsed .yt-summary-overview-toggle svg {
    transform: rotate(-90deg);
  }
  
  .yt-summary-overview-card.collapsed .yt-summary-overview-body {
    display: none;
  }
  
  .yt-summary-overview-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  
  .yt-summary-overview-item {
    position: relative;
    padding-left: 16px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--yts-text-primary);
    font-weight: 450;
  }
  
  .yt-summary-overview-item::before {
    content: "✦";
    position: absolute;
    left: 1px;
    top: 0px;
    color: var(--yts-accent);
    font-size: 11px;
  }
  
  .yt-summary-overview-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--yts-text-secondary);
    font-style: italic;
    padding: 4px 0;
  }
  
  .yt-summary-overview-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(252, 63, 29, 0.25);
    border-top-color: var(--yts-accent);
    border-radius: 50%;
    animation: yts-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  
  /* Chapters & Keypoints */
  .yt-summary-chapter {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background-color: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--yts-border);
    border-radius: 10px;
    padding: 12px 14px;
    transition: border-color 0.2s ease, background-color 0.2s ease;
  }
  
  .yt-summary-chapter:hover {
    background-color: var(--yts-surface-hover);
    border-color: rgba(252, 63, 29, 0.3);
  }
  
  .yt-summary-chapter-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  
  .yt-summary-timecode {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 6px;
    background-color: var(--yts-timecode-bg);
    color: var(--yts-timecode-text);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
    user-select: none;
    flex-shrink: 0;
  }
  
  .yt-summary-timecode:hover {
    background-color: var(--yts-timecode-hover);
    transform: translateY(-1px);
    border-color: rgba(252, 63, 29, 0.35);
  }
  
  .yt-summary-timecode svg {
    width: 10px;
    height: 10px;
    fill: currentColor;
  }
  
  .yt-summary-chapter-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--yts-text-primary);
    line-height: 1.35;
    flex: 1;
  }
  
  /* Theses (bullet points) */
  .yt-summary-theses {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .yt-summary-thesis {
    position: relative;
    padding-left: 14px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--yts-text-secondary);
  }
  
  .yt-summary-thesis::before {
    content: "•";
    position: absolute;
    left: 2px;
    color: var(--yts-accent);
    font-weight: bold;
  }
  
  /* Loading View */
  .yt-summary-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 36px 16px;
    gap: 16px;
    text-align: center;
  }
  
  .yt-summary-spinner {
    width: 38px;
    height: 38px;
    border: 3px solid rgba(252, 63, 29, 0.2);
    border-top-color: var(--yts-accent);
    border-radius: 50%;
    animation: yts-spin 0.9s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite;
  }
  
  .yt-summary-loading-text {
    font-size: 14px;
    font-weight: 500;
    color: var(--yts-text-primary);
  }
  
  .yt-summary-loading-subtext {
    font-size: 12px;
    color: var(--yts-text-secondary);
  }
  
  .yt-summary-skeleton-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 10px;
  }
  
  .yt-summary-skeleton-bar {
    height: 14px;
    border-radius: 6px;
    background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.04) 75%);
    background-size: 200% 100%;
    animation: yts-skeleton-wave 1.5s infinite;
  }
  
  /* Error View */
  .yt-summary-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    gap: 12px;
    text-align: center;
  }
  
  .yt-summary-error-icon svg {
    width: 44px;
    height: 44px;
    fill: #e53935;
  }
  
  .yt-summary-error-msg {
    font-size: 13.5px;
    color: var(--yts-text-primary);
    line-height: 1.4;
  }
  
  .yt-summary-retry-btn {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border-radius: 18px;
    background-color: var(--yts-accent);
    color: #ffffff;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  
  .yt-summary-retry-btn:hover {
    background-color: var(--yts-accent-hover);
  }
  
  /* Animations */
  @keyframes yts-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @keyframes yts-skeleton-wave {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  
  /* Floating Action Button Fallback */
  .yt-summary-floating-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2001;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 18px;
    border-radius: 20px;
    background: linear-gradient(135deg, #fc3f1d, #ff5233);
    color: #ffffff;
    border: none;
    font-family: "Roboto", "Segoe UI", Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(252, 63, 29, 0.45);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    user-select: none;
  }
  
  .yt-summary-floating-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(252, 63, 29, 0.6);
  }
  
  .yt-summary-floating-btn:active {
    transform: translateY(0);
  }
  
  .yt-summary-floating-btn svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  `;
  
  /**
   * Injects styles into the document head or via GM_addStyle if available.
   * @param {Document} [doc=document]
   */
  function injectStyles(doc = (typeof document !== 'undefined' ? document : null)) {
    if (!doc) return;
    const STYLE_ID = 'yt-summary-injected-styles';
  
    if (typeof globalThis.GM_addStyle === 'function') {
      globalThis.GM_addStyle(UI_STYLES);
      return;
    }
  
    if (doc.getElementById && doc.getElementById(STYLE_ID)) {
      return;
    }
  
    const styleEl = doc.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = UI_STYLES;
    (doc.head || doc.body || doc.documentElement).appendChild(styleEl);
  }

  // =========================================================================
  // Part 7: DOM and Trusted Types Safety Utilities (ui/dom-utils.js)
  // =========================================================================

  /**
   * DOM & Trusted Types Utility Helpers.
   * YouTube strictly enforces Trusted Types (CSP require-trusted-types-for 'script').
   * Direct assignment to .innerHTML throws:
   * "TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment."
   *
   * This module provides safe, CSP-compliant DOM manipulation using:
   * 1. Direct assignment when permitted (e.g. Node.js mock DOM or non-restricted environments).
   * 2. window.trustedTypes policy when available.
   * 3. DOMParser + Document.importNode fallback (bypasses TrustedHTML sinks on Chrome/YouTube).
   * 4. Safe element clearing without innerHTML = ''.
   */
  
  let trustedPolicy = null;
  let policyAttempted = false;
  
  /**
   * Lazily obtains or creates a Trusted Types policy.
   * @returns {TrustedTypePolicy | { createHTML: (s: string) => string } | null}
   */
  function getTrustedPolicy() {
    if (policyAttempted) return trustedPolicy;
    policyAttempted = true;
  
    const tt = typeof window !== 'undefined' ? (window.trustedTypes || globalThis.trustedTypes) : null;
    if (!tt || typeof tt.createPolicy !== 'function') {
      return null;
    }
  
    // Attempt custom policy name first
    try {
      trustedPolicy = tt.createPolicy('youtube-summarizer', {
        createHTML: (s) => s
      });
      return trustedPolicy;
    } catch (_) {}
  
    // Attempt default policy fallback
    try {
      trustedPolicy = tt.createPolicy('default', {
        createHTML: (s) => s
      });
      return trustedPolicy;
    } catch (_) {}
  
    // If already exists, return default policy
    try {
      if (tt.defaultPolicy) {
        trustedPolicy = tt.defaultPolicy;
        return trustedPolicy;
      }
    } catch (_) {}
  
    return null;
  }
  
  /**
   * Safely removes all child nodes from an element without setting innerHTML = ''.
   * @param {HTMLElement} element
   */
  function clearElement(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    if (element.children && element.children.length > 0) {
      while (element.children.length > 0) {
        element.removeChild(element.children[0]);
      }
    }
  }
  
  /**
   * Safely sets HTML content on an element, complying with YouTube's Trusted Types CSP.
   *
   * @param {HTMLElement} element Target container
   * @param {string} htmlString HTML markup string
   * @param {Document} [doc=document] Document context
   */
  function setSafeHTML(element, htmlString, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!element) return;
  
    // 1. Try direct assignment (succeeds in mock environments or non-restricted contexts)
    try {
      element.innerHTML = htmlString;
      return;
    } catch (_) {
      // Caught TrustedHTML assignment error: fall through to DOMParser & Trusted Types
    }
  
    // 2. Try Trusted Types policy if available
    const policy = getTrustedPolicy();
    if (policy && typeof policy.createHTML === 'function') {
      try {
        element.innerHTML = policy.createHTML(htmlString);
        return;
      } catch (_) {}
    }
  
    // 3. Fallback: Parse via DOMParser and append imported nodes (bypasses innerHTML sink)
    try {
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(htmlString, 'text/html');
        clearElement(element);
  
        const targetDoc = doc || element.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const childNodes = Array.from(parsedDoc.body.childNodes);
  
        for (const node of childNodes) {
          const imported = targetDoc && typeof targetDoc.importNode === 'function'
            ? targetDoc.importNode(node, true)
            : node;
          element.appendChild(imported);
        }
        return;
      }
    } catch (_) {}
  
    // 4. Last-ditch text fallback
    element.textContent = htmlString;
  }
  
  /**
   * Safely appends HTML markup to an element without clearing existing children.
   *
   * @param {HTMLElement} element Target container
   * @param {string} htmlString HTML markup string
   * @param {Document} [doc=document] Document context
   */
  function appendSafeHTML(element, htmlString, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!element) return;
  
    // 1. If in browser with DOMParser, parse and append directly without innerHTML sink
    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(htmlString, 'text/html');
        const targetDoc = doc || element.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const childNodes = Array.from(parsedDoc.body.childNodes);
  
        if (childNodes.length > 0) {
          for (const node of childNodes) {
            const imported = targetDoc && typeof targetDoc.importNode === 'function'
              ? targetDoc.importNode(node, true)
              : node;
            element.appendChild(imported);
          }
          return;
        }
      } catch (_) {}
    }
  
    // 2. Mock environment or fallback: transfer via temporary container
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    const temp = targetDoc ? targetDoc.createElement('div') : null;
    if (temp) {
      setSafeHTML(temp, htmlString, doc);
      while (temp.firstChild || (temp.children && temp.children.length > 0)) {
        const child = temp.firstChild || temp.children[0];
        element.appendChild(child);
      }
      return;
    }
  
    try {
      element.innerHTML += htmlString;
    } catch (_) {
      element.textContent += htmlString;
    }
  }

  // =========================================================================
  // Part 8: Action Bar Button Component (ui/button.js)
  // =========================================================================

  /**
   * YouTube Action Bar Button Component & DOM Injector.
   * Matches YouTube's native action bar button styles (pill shape, icon, hover, active).
   */
  
  const AI_SPARKLES_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" aria-hidden="true">
    <path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/>
  </svg>
  `;
  
  /**
   * Creates a summary button instance with reactive state helpers.
   *
   * @param {{
   *   onClick?: (e: MouseEvent) => void,
   *   doc?: Document
   * }} [options={}]
   * @returns {{
   *   getElement: () => HTMLElement,
   *   setLoading: (loading: boolean) => void,
   *   setActive: (active: boolean) => void
   * }}
   */
  function createSummaryButton({ onClick, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
    if (!doc) {
      throw new Error("Document object is required to create button");
    }
  
    const btn = doc.createElement('button');
    btn.className = 'yt-summary-btn yt-spec-button-shape-next';
    btn.id = 'yt-summary-action-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Краткий пересказ нейросетью');
    btn.title = 'Получить краткий пересказ видео с ключевыми таймкодами';
  
    const iconSpan = doc.createElement('span');
    iconSpan.className = 'yt-summary-btn-icon';
    appendSafeHTML(iconSpan, AI_SPARKLES_SVG.trim(), doc);
  
    const textSpan = doc.createElement('span');
    textSpan.className = 'yt-summary-btn-text';
    textSpan.textContent = 'Пересказ';
  
    btn.appendChild(iconSpan);
    btn.appendChild(textSpan);
  
    if (typeof onClick === 'function') {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        onClick(e);
      });
    }
  
    return {
      getElement: () => btn,
  
      setLoading: (loading) => {
        if (loading) {
          btn.classList.add('loading');
          btn.disabled = true;
        } else {
          btn.classList.remove('loading');
          btn.disabled = false;
        }
      },
  
      setActive: (active) => {
        if (active) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    };
  }
  
  /**
   * Injects the summary button into YouTube's action bar.
   * Tries multiple selector targets and guarantees no duplicates.
   *
   * @param {HTMLElement} buttonEl
   * @param {Document} [doc=document]
   * @returns {boolean} true if button was mounted or already present
   */
  function injectSummaryButton(buttonEl, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!buttonEl || !doc) return false;
  
    // Check if button is already inside DOM and attached
    if (doc.querySelector && doc.querySelector('#yt-summary-action-btn')) {
      const existing = doc.querySelector('#yt-summary-action-btn');
      if (existing === buttonEl && (doc.body?.contains ? doc.body.contains(buttonEl) : true)) {
        return true;
      }
      if (existing && existing !== buttonEl && (doc.body?.contains ? doc.body.contains(existing) : true)) {
        return true;
      }
    }
  
    // 1. Prioritize visible watch metadata action bar
    const primaryContainers = [
      'ytd-watch-metadata #top-level-buttons-computed',
      'ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed',
      'ytd-watch-metadata #top-row #actions #top-level-buttons-computed',
      'ytd-watch-metadata #actions #top-level-buttons-computed',
      '#menu #top-level-buttons-computed',
      '#top-level-buttons-computed',
      'ytd-menu-renderer #top-level-buttons-computed'
    ];
  
    for (const selector of primaryContainers) {
      const container = doc.querySelector ? doc.querySelector(selector) : null;
      if (container && !container.closest?.('yt-player-quick-action-buttons')) {
        const likeBtn = container.querySelector(
          'ytd-segmented-like-dislike-button-renderer, ' +
          'segmented-like-dislike-button-view-model, ' +
          'like-button-view-model, ' +
          '#segmented-like-button'
        );
        if (likeBtn) {
          try {
            container.insertBefore(buttonEl, likeBtn);
            return true;
          } catch (_) {}
        }
        if (typeof container.prepend === 'function') {
          container.prepend(buttonEl);
        } else {
          container.appendChild(buttonEl);
        }
        return true;
      }
    }
  
    // 2. Direct like button search (excluding quick action buttons)
    const candidateLikeButtons = doc.querySelectorAll ? Array.from(doc.querySelectorAll(
      'ytd-segmented-like-dislike-button-renderer, ' +
      'segmented-like-dislike-button-view-model, ' +
      'like-button-view-model, ' +
      '#segmented-like-button'
    )) : [];
  
    for (const likeBtn of candidateLikeButtons) {
      if (likeBtn.closest?.('yt-player-quick-action-buttons')) continue;
      if (likeBtn.parentElement) {
        try {
          likeBtn.parentElement.insertBefore(buttonEl, likeBtn);
          return true;
        } catch (_) {}
      }
    }
  
    // 3. Fallback target containers on YouTube watch / shorts pages
    const targetSelectors = [
      'yt-flexible-actions-view-model',
      'ytd-watch-metadata yt-flexible-actions-view-model',
      '#top-row #actions',
      'ytd-watch-metadata #actions',
      '#actions #top-level-buttons-computed',
      '#actions-inner',
      'ytd-watch-metadata #owner',
      '#owner #subscribe-button',
      'ytd-reel-player-overlay-renderer #actions',
      'ytd-shorts #actions'
    ];
  
    for (const selector of targetSelectors) {
      const container = doc.querySelector ? doc.querySelector(selector) : null;
      if (container && !container.closest?.('yt-player-quick-action-buttons')) {
        if (typeof container.prepend === 'function') {
          container.prepend(buttonEl);
        } else {
          container.appendChild(buttonEl);
        }
        return true;
      }
    }
  
    return false;
  }

  // =========================================================================
  // Part 9: Sidebar Drawer Panel Component (ui/panel.js)
  // =========================================================================

  /**
   * YouTube Summarizer Sidebar Drawer Panel Component.
   * Supports smooth slide-in/out, horizontal dragging, loading skeleton,
   * chapter timecodes with seek callback, and plain text copying.
   */
  
  const ICONS = {
    SPARKLES: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>`,
    COPY: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    CHECK: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    CLOSE: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    PLAY: `<svg viewBox="0 0 24 24" width="10" height="10"><polygon fill="currentColor" points="6 4 20 12 6 20 6 4"/></svg>`,
    CHEVRON: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`,
    ERROR: `<svg viewBox="0 0 24 24" width="40" height="40"><path fill="#e53935" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`
  };
  class SummaryDrawerPanel {
    /**
     * @param {{
     *   container?: HTMLElement,
     *   doc?: Document,
     *   onClose?: () => void,
     *   onTimecodeClick?: (seconds: number) => void,
     *   onRetry?: () => void
     * }} [options={}]
     */
    constructor({
      container,
      doc = (typeof document !== 'undefined' ? document : null),
      onClose,
      onTimecodeClick,
      onRetry
    } = {}) {
      if (!doc) {
        throw new Error("Document object is required for SummaryDrawerPanel");
      }
  
      this.doc = doc;
      this.container = container || doc.body;
      this.onClose = onClose;
      this.onTimecodeClick = onTimecodeClick;
      this.onRetry = onRetry;
  
      this.currentSummary = null;
      this._isOpen = false;
  
      this._initDOM();
      this._initDragging();
    }
  
    /**
     * Constructs drawer structure and attaches to container.
     * @private
     */
    _initDOM() {
      // Remove old drawer if present
      const old = this.container.querySelector('.yt-summary-drawer');
      if (old) old.remove();
  
      this.element = this.doc.createElement('div');
      this.element.className = 'yt-summary-drawer';
      this.element.id = 'yt-summary-drawer-panel';
  
      setSafeHTML(this.element, `
        <div class="yt-summary-drawer-header">
          <div class="yt-summary-header-title">
            ${ICONS.SPARKLES}
            <span>Пересказ</span>
            <span class="yt-summary-badge">YandexGPT</span>
          </div>
          <div class="yt-summary-header-actions">
            <button type="button" class="yt-summary-icon-btn yt-summary-btn-copy" title="Скопировать пересказ">
              ${ICONS.COPY}
            </button>
            <button type="button" class="yt-summary-icon-btn yt-summary-btn-close" title="Закрыть панель">
              ${ICONS.CLOSE}
            </button>
          </div>
        </div>
        <div class="yt-summary-drawer-content">
          <div class="yt-summary-empty-msg">Нажмите «Пересказ» под видео, чтобы получить краткое содержание.</div>
        </div>
      `, this.doc);
  
      this.headerEl = this.element.querySelector('.yt-summary-drawer-header');
      this.contentEl = this.element.querySelector('.yt-summary-drawer-content');
      this.copyBtn = this.element.querySelector('.yt-summary-btn-copy');
      this.closeBtn = this.element.querySelector('.yt-summary-btn-close');
  
      this.copyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyFullText();
      });
  
      this.closeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
        if (typeof this.onClose === 'function') {
          this.onClose();
        }
      });
  
      this.container.appendChild(this.element);
    }
  
    /**
     * Sets up smooth draggable header for user-controlled panel position.
     * @private
     */
    _initDragging() {
      if (!this.headerEl) return;
  
      let isDragging = false;
      let startX = 0;
      let startRight = 16;
  
      const onMouseDown = (e) => {
        // Don't drag if clicking buttons
        if (e.target.closest && (e.target.closest('button') || e.target.closest('.yt-summary-icon-btn'))) {
          return;
        }
  
        isDragging = true;
        startX = e.clientX || 0;
  
        const computedRight = parseInt(this.element.style.right || '16', 10);
        startRight = isNaN(computedRight) ? 16 : computedRight;
  
        if (this.doc.addEventListener) {
          this.doc.addEventListener('mousemove', onMouseMove);
          this.doc.addEventListener('mouseup', onMouseUp);
        }
      };
  
      const onMouseMove = (e) => {
        if (!isDragging) return;
        const currentX = e.clientX || 0;
        const deltaX = currentX - startX;
        // Moving right increases deltaX, decreasing right distance
        const newRight = Math.max(10, Math.min(window.innerWidth - 300, startRight - deltaX));
        this.element.style.right = `${newRight}px`;
      };
  
      const onMouseUp = () => {
        isDragging = false;
        if (this.doc.removeEventListener) {
          this.doc.removeEventListener('mousemove', onMouseMove);
          this.doc.removeEventListener('mouseup', onMouseUp);
        }
      };
  
      this.headerEl.addEventListener('mousedown', onMouseDown);
    }
  
    /**
     * Returns whether the drawer is currently open.
     * @returns {boolean}
     */
    isOpen() {
      return this._isOpen;
    }
  
    /**
     * Shows drawer.
     */
    show() {
      this._isOpen = true;
      this.element.classList.add('open');
    }
  
    /**
     * Hides drawer.
     */
    hide() {
      this._isOpen = false;
      this.element.classList.remove('open');
    }
  
    /**
     * Toggles drawer open/closed state.
     */
    toggle() {
      if (this._isOpen) {
        this.hide();
      } else {
        this.show();
      }
    }
  
    /**
     * Displays loading state with animated spinner and skeleton lines.
     * @param {{ approximateWaitingTime?: number, status?: string }} [progressInfo={}]
     */
    setLoading(progressInfo = {}) {
      const waitTime = progressInfo.approximateWaitingTime;
      const waitText = waitTime ? `Примерное время: ~${waitTime} сек.` : 'Обработка видео нейросетью...';
  
      setSafeHTML(this.contentEl, `
        <div class="yt-summary-loading">
          <div class="yt-summary-spinner"></div>
          <div class="yt-summary-loading-text">ИИ анализирует аудиодорожку и тезисы</div>
          <div class="yt-summary-loading-subtext">${waitText}</div>
          <div class="yt-summary-skeleton-container">
            <div class="yt-summary-skeleton-bar" style="width: 85%;"></div>
            <div class="yt-summary-skeleton-bar" style="width: 100%;"></div>
            <div class="yt-summary-skeleton-bar" style="width: 70%;"></div>
            <div class="yt-summary-skeleton-bar" style="width: 90%;"></div>
          </div>
        </div>
      `, this.doc);
    }
  
    /**
     * Renders parsed summary data (chapters, timestamps, and bullet points).
     *
     * @param {{
     *   title?: string,
     *   keypoints: Array<{ startTime: number, timecode: string, title: string, theses: string[] }>
     * }} summaryData
     * @param {(seconds: number) => void} [onTimecodeClick]
     */
    renderSummary(summaryData, onTimecodeClick) {
      this.currentSummary = summaryData ? { ...summaryData } : null;
      const timecodeHandler = onTimecodeClick || this.onTimecodeClick;
  
      // Clear content safely without innerHTML
      clearElement(this.contentEl);
  
      if (!summaryData || !Array.isArray(summaryData.keypoints) || summaryData.keypoints.length === 0) {
        setSafeHTML(this.contentEl, `
          <div class="yt-summary-empty-msg">Пересказ для этого видео отсутствует или не содержит тезисов.</div>
        `, this.doc);
        return;
      }
  
      // Video title header if provided
      if (summaryData.title) {
        const titleEl = this.doc.createElement('div');
        titleEl.className = 'yt-summary-video-title';
        titleEl.textContent = summaryData.title;
        this.contentEl.appendChild(titleEl);
      }
  
      // Top Overview Card (Executive Summary)
      const overviewCard = this.doc.createElement('div');
      overviewCard.className = 'yt-summary-overview-card';
      overviewCard.id = 'yt-summary-overview-card';
  
      const overviewHeader = this.doc.createElement('div');
      overviewHeader.className = 'yt-summary-overview-header';
      setSafeHTML(overviewHeader, `
        <div class="yt-summary-overview-title">
          ${ICONS.SPARKLES}
          <span>Главное из видео</span>
          <span class="yt-summary-overview-badge">ИТОГ</span>
        </div>
        <button type="button" class="yt-summary-overview-toggle" title="Свернуть / развернуть итог">
          ${ICONS.CHEVRON}
        </button>
      `, this.doc);
  
      const toggleBtn = overviewHeader.querySelector('.yt-summary-overview-toggle');
      toggleBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        overviewCard.classList.toggle('collapsed');
      });
  
      overviewCard.appendChild(overviewHeader);
  
      const overviewBody = this.doc.createElement('div');
      overviewBody.className = 'yt-summary-overview-body';
  
      if (Array.isArray(summaryData.overallTheses) && summaryData.overallTheses.length > 0) {
        const listEl = this.doc.createElement('ul');
        listEl.className = 'yt-summary-overview-list';
        for (const item of summaryData.overallTheses) {
          const li = this.doc.createElement('li');
          li.className = 'yt-summary-overview-item';
          li.textContent = item;
          listEl.appendChild(li);
        }
        overviewBody.appendChild(listEl);
      } else {
        setSafeHTML(overviewBody, `
          <div class="yt-summary-overview-loading">
            <div class="yt-summary-overview-spinner"></div>
            <span>Нейросеть YandexGPT выделяет главное...</span>
          </div>
        `, this.doc);
      }
  
      overviewCard.appendChild(overviewBody);
      this.contentEl.appendChild(overviewCard);
  
      // Chapters container
      const chaptersContainer = this.doc.createElement('div');
      chaptersContainer.className = 'yt-summary-chapters-list';
  
      for (const kp of summaryData.keypoints) {
        const chapterEl = this.doc.createElement('div');
        chapterEl.className = 'yt-summary-chapter';
  
        // Chapter header
        const headerEl = this.doc.createElement('div');
        headerEl.className = 'yt-summary-chapter-header';
  
        // Timecode button
        const timecodeBtn = this.doc.createElement('button');
        timecodeBtn.type = 'button';
        timecodeBtn.className = 'yt-summary-timecode';
        timecodeBtn.title = `Перейти к ${kp.timecode}`;
        setSafeHTML(timecodeBtn, `${ICONS.PLAY} <span>${kp.timecode}</span>`, this.doc);
  
        timecodeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof timecodeHandler === 'function') {
            timecodeHandler(kp.startTime);
          }
        });
  
        // Chapter Title
        const titleSpan = this.doc.createElement('span');
        titleSpan.className = 'yt-summary-chapter-title';
        titleSpan.textContent = kp.title || 'Раздел';
  
        headerEl.appendChild(timecodeBtn);
        headerEl.appendChild(titleSpan);
        chapterEl.appendChild(headerEl);
  
        // Theses list
        if (Array.isArray(kp.theses) && kp.theses.length > 0) {
          const listEl = this.doc.createElement('ul');
          listEl.className = 'yt-summary-theses';
  
          for (const thesis of kp.theses) {
            const itemEl = this.doc.createElement('li');
            itemEl.className = 'yt-summary-thesis';
            itemEl.textContent = thesis;
            listEl.appendChild(itemEl);
          }
  
          chapterEl.appendChild(listEl);
        }
  
        chaptersContainer.appendChild(chapterEl);
      }
  
      this.contentEl.appendChild(chaptersContainer);
    }
  
    /**
     * Dynamically updates the executive summary overview card with finished theses.
     * @param {string[]} overallTheses
     */
    updateOverview(overallTheses) {
      if (this.currentSummary) {
        this.currentSummary.overallTheses = overallTheses;
      }
      const overviewCard = this.contentEl?.querySelector?.('#yt-summary-overview-card');
      if (!overviewCard) return;
  
      const overviewBody = overviewCard.querySelector?.('.yt-summary-overview-body');
      if (!overviewBody) return;
  
      clearElement(overviewBody);
  
      if (Array.isArray(overallTheses) && overallTheses.length > 0) {
        const listEl = this.doc.createElement('ul');
        listEl.className = 'yt-summary-overview-list';
        for (const item of overallTheses) {
          const li = this.doc.createElement('li');
          li.className = 'yt-summary-overview-item';
          li.textContent = item;
          listEl.appendChild(li);
        }
        overviewBody.appendChild(listEl);
      }
    }
  
    /**
     * Displays error view with retry action button.
     *
     * @param {string} errorMessage
     * @param {() => void} [onRetry]
     */
    renderError(errorMessage, onRetry) {
      const retryHandler = onRetry || this.onRetry;
  
      setSafeHTML(this.contentEl, `
        <div class="yt-summary-error">
          <div class="yt-summary-error-icon">${ICONS.ERROR}</div>
          <div class="yt-summary-error-msg">${errorMessage || 'Произошла ошибка при получении пересказа'}</div>
          <button type="button" class="yt-summary-retry-btn">
            Повторить попытку
          </button>
        </div>
      `, this.doc);
  
      const retryBtn = this.contentEl.querySelector('.yt-summary-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (typeof retryHandler === 'function') {
            retryHandler();
          }
        });
      }
    }
  
    /**
     * Formats the current summary into readable plain text and copies to clipboard.
     * @returns {string} Formatted text
     */
    copyFullText() {
      if (!this.currentSummary) return '';
  
      const lines = [];
  
      if (this.currentSummary.title) {
        lines.push(`📌 ${this.currentSummary.title}`);
        lines.push('');
      }
  
      if (Array.isArray(this.currentSummary.overallTheses) && this.currentSummary.overallTheses.length > 0) {
        lines.push('💡 ГЛАВНОЕ ИЗ ВИДЕО (YandexGPT):');
        for (const th of this.currentSummary.overallTheses) {
          lines.push(`• ${th}`);
        }
        lines.push('');
      }
  
      if (Array.isArray(this.currentSummary.keypoints) && this.currentSummary.keypoints.length > 0) {
        lines.push('⏱️ СОДЕРЖАНИЕ ПО ГЛАВАМ:');
        for (const kp of this.currentSummary.keypoints) {
          lines.push(`[${kp.timecode}] ${kp.title || ''}`.trim());
          if (Array.isArray(kp.theses)) {
            for (const thesis of kp.theses) {
              lines.push(`• ${thesis}`);
            }
          }
          lines.push('');
        }
      }
  
      const fullText = lines.join('\n').trim();
  
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(fullText).catch(err => {
          console.warn('Clipboard write failed:', err);
        });
      }
  
      // Feedback on copy button
      if (this.copyBtn) {
        this.copyBtn.classList.add('copied');
        setTimeout(() => {
          this.copyBtn.classList.remove('copied');
        }, 2000);
      }
  
      return fullText;
    }
  
    /**
     * Cleans up panel DOM element and event listeners.
     */
    destroy() {
      if (this.element) {
        this.element.remove();
      }
    }
  }

  // =========================================================================
  // Part 10: YouTube SPA Observer & Controller (ui/observer.js)
  // =========================================================================

  /**
   * YouTube Page Navigation Observer & Controller.
   * Manages SPA navigation events (yt-navigate-finish, spfdone, popstate),
   * button injection lifecycle, player seeking, and summarizer coordination.
   */
  class YouTubeController {
    /**
     * @param {{
     *   summarizer?: YandexVideoSummarizer,
     *   panel?: SummaryDrawerPanel,
     *   button?: ReturnType<typeof createSummaryButton>,
     *   document?: Document,
     *   window?: Window
     * }} [options={}]
     */
    constructor({
      summarizer,
      panel,
      button,
      document: doc = (typeof document !== 'undefined' ? document : null),
      window: win = (typeof window !== 'undefined' ? window : null)
    } = {}) {
      this.doc = doc;
      this.win = win;
  
      this.summarizer = summarizer || new YandexVideoSummarizer();
      this.button = button || null;
      this.panel = panel || null;
  
      this.lastVideoId = null;
      this.isLoading = false;
      this.mutationObserver = null;
  
      this._onNavigate = this._onNavigate.bind(this);
      this.handleSummarizeClick = this.handleSummarizeClick.bind(this);
    }
  
    /**
     * Initializes the controller, styles, UI elements, and YouTube SPA observers.
     */
    init() {
      if (!this.doc || !this.win) return;
  
      // 1. Inject styles
      injectStyles(this.doc);
  
      // 2. Initialize button if not provided
      if (!this.button) {
        this.button = createSummaryButton({
          onClick: this.handleSummarizeClick,
          doc: this.doc
        });
      }
  
      // 3. Initialize panel if not provided
      if (!this.panel) {
        this.panel = new SummaryDrawerPanel({
          container: this.doc.body,
          doc: this.doc,
          onTimecodeClick: (seconds) => this.seekTo(seconds),
          onRetry: () => this.handleSummarizeClick()
        });
      }
  
      // 4. Bind YouTube SPA navigation events
      this.win.addEventListener('yt-navigate-finish', this._onNavigate);
      this.win.addEventListener('spfdone', this._onNavigate);
      this.win.addEventListener('popstate', this._onNavigate);
  
      // 5. MutationObserver to inject button once action bar renders
      if (typeof globalThis.MutationObserver !== 'undefined' && this.doc.body) {
        this.mutationObserver = new globalThis.MutationObserver(() => {
          if (this.isWatchPage()) {
            this.tryInjectButton();
          }
        });
  
        this.mutationObserver.observe(this.doc.body, {
          childList: true,
          subtree: true
        });
      }
  
      // 6. Initial page check
      this.onPageChanged();
    }
  
    /**
     * Checks whether the current or specified URL represents a video watch page.
     *
     * @param {string} [url]
     * @returns {boolean}
     */
    isWatchPage(url) {
      const targetUrl = url || (this.win?.location?.href || '');
      if (!targetUrl) return false;
  
      // Watch page or shorts page
      if (/\/watch|\/shorts\//i.test(targetUrl)) {
        return true;
      }
  
      // Check if video ID can be extracted
      return Boolean(extractYouTubeVideoId(targetUrl));
    }
  
    /**
     * Extracts video ID for the current or specified URL.
     *
     * @param {string} [url]
     * @returns {string | null}
     */
    getVideoId(url) {
      const targetUrl = url || (this.win?.location?.href || '');
      return extractYouTubeVideoId(targetUrl);
    }
  
    /**
     * Attempts to inject the action bar button into YouTube DOM.
     * If action bar is not found after a delay, provides a floating fallback trigger.
     * @returns {boolean}
     */
    tryInjectButton() {
      if (!this.button || !this.doc) return false;
      const btnEl = this.button.getElement();
      const injected = injectSummaryButton(btnEl, this.doc);
      if (injected) {
        this.removeFloatingFallback();
        return true;
      }
  
      if (this.isWatchPage()) {
        this.scheduleFloatingFallback();
      }
      return false;
    }
  
    /**
     * Schedules mounting of a floating button if the action bar container takes too long to render.
     */
    scheduleFloatingFallback() {
      if (this._floatingTimer) return;
      this._floatingTimer = setTimeout(() => {
        this._floatingTimer = null;
        if (this.isWatchPage() && !this.doc.querySelector?.('#yt-summary-action-btn')) {
          this.ensureFloatingFallback();
        }
      }, 2000);
    }
  
    /**
     * Ensures a floating trigger button is mounted on the page.
     */
    ensureFloatingFallback() {
      if (!this.doc || !this.doc.body) return;
      if (this.doc.querySelector?.('#yt-summary-floating-btn')) return;
  
      const floatBtn = this.doc.createElement('button');
      floatBtn.id = 'yt-summary-floating-btn';
      floatBtn.className = 'yt-summary-floating-btn';
      floatBtn.setAttribute('type', 'button');
      floatBtn.title = 'Получить краткий пересказ видео (YandexGPT)';
      appendSafeHTML(floatBtn, `
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" aria-hidden="true">
          <path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/>
        </svg>
        <span>✨ Пересказ</span>
      `, this.doc);
  
      floatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSummarizeClick();
      });
  
      this.doc.body.appendChild(floatBtn);
    }
  
    /**
     * Removes floating button and cancels scheduled timer.
     */
    removeFloatingFallback() {
      if (this._floatingTimer) {
        clearTimeout(this._floatingTimer);
        this._floatingTimer = null;
      }
      const floatBtn = this.doc?.querySelector?.('#yt-summary-floating-btn');
      if (floatBtn && typeof floatBtn.remove === 'function') {
        floatBtn.remove();
      }
    }
  
    /**
     * Seeks YouTube player to the specified timestamp in seconds and starts playback.
     *
     * @param {number} seconds
     */
    seekTo(seconds) {
      if (!this.doc) return;
  
      const video = this.doc.querySelector('video.html5-main-video') ||
                    this.doc.querySelector('.html5-main-video') ||
                    this.doc.querySelector('video');
  
      if (video) {
        video.currentTime = Math.max(0, Number(seconds) || 0);
        try {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch (e) {
          // Ignored
        }
      }
    }
  
    /**
     * Handles user click on the summary action button.
     */
    async handleSummarizeClick() {
      if (this.isLoading) return;
  
      if (!this.panel.isOpen()) {
        this.panel.show();
      }
  
      const currentUrl = this.win?.location?.href || '';
      const videoId = this.getVideoId(currentUrl);
  
      if (!videoId) {
        this.panel.renderError('Не удалось определить видео на странице', () => this.handleSummarizeClick());
        return;
      }
  
      this.isLoading = true;
      this.button.setLoading(true);
      this.panel.setLoading({ status: 'starting' });
  
      try {
        let chaptersRendered = false;
  
        const summaryResult = await this.summarizer.summarizeVideo(currentUrl, {
          context: {
            window: this.win,
            unsafeWindow: typeof unsafeWindow !== 'undefined' ? unsafeWindow : this.win,
            document: this.doc
          },
          onProgress: (progress) => {
            if (!chaptersRendered) {
              this.panel.setLoading(progress);
            }
          },
          onChaptersReady: (intermediateResult) => {
            chaptersRendered = true;
            this.button.setLoading(false);
            this.button.setActive(true);
            this.panel.renderSummary(intermediateResult, (time) => this.seekTo(time));
          }
        });
  
        this.button.setLoading(false);
        this.button.setActive(true);
  
        if (!chaptersRendered) {
          this.panel.renderSummary(summaryResult, (time) => this.seekTo(time));
        } else if (Array.isArray(summaryResult.overallTheses) && summaryResult.overallTheses.length > 0) {
          this.panel.updateOverview(summaryResult.overallTheses);
        }
      } catch (err) {
        this.button.setLoading(false);
        this.panel.renderError(
          err?.message || 'Не удалось получить пересказ видео',
          () => this.handleSummarizeClick()
        );
      } finally {
        this.isLoading = false;
      }
    }
  
    /**
     * Event listener callback for YouTube navigation.
     * @private
     */
    _onNavigate() {
      this.onPageChanged();
    }
  
    /**
     * Handles page / URL state changes.
     */
    onPageChanged() {
      const currentVideoId = this.getVideoId();
  
      if (currentVideoId !== this.lastVideoId) {
        this.lastVideoId = currentVideoId;
        if (this.button) {
          this.button.setActive(false);
          this.button.setLoading(false);
        }
      }
  
      if (this.isWatchPage()) {
        this.tryInjectButton();
      } else {
        this.removeFloatingFallback();
      }
    }
  
    /**
     * Cleans up observers, elements, and event listeners.
     */
    destroy() {
      this.removeFloatingFallback();
  
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
  
      if (this.win) {
        this.win.removeEventListener('yt-navigate-finish', this._onNavigate);
        this.win.removeEventListener('spfdone', this._onNavigate);
        this.win.removeEventListener('popstate', this._onNavigate);
      }
  
      if (this.panel) {
        this.panel.destroy();
      }
  
      if (this.button) {
        this.button.getElement()?.remove();
      }
    }
  }


  // =========================================================================
  // Userscript Runtime Environment & Adapters
  // =========================================================================

  /**
   * Creates a Fetch-compatible adaptor utilizing Tampermonkey GM_xmlhttpRequest.
   * Enables seamless cross-origin requests to 300.ya.ru and api.browser.yandex.ru.
   * Falls back to standard fetch if GM_xmlhttpRequest is not available.
   */
  function createGmFetch() {
    if (typeof GM_xmlhttpRequest === 'function') {
      return function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
          if (options.signal?.aborted) {
            const err = new Error("Request aborted");
            err.name = "AbortError";
            return reject(err);
          }

          const isProtobuf = Boolean(
            options.headers && (
              (typeof options.headers['Content-Type'] === 'string' && options.headers['Content-Type'].includes('protobuf')) ||
              (typeof options.headers['Accept'] === 'string' && options.headers['Accept'].includes('protobuf'))
            )
          );

          const requestDetails = {
            method: options.method || 'GET',
            url: String(url),
            headers: options.headers || {},
            data: options.body,
            responseType: isProtobuf ? 'arraybuffer' : 'text',
            onload: (res) => {
              const ok = res.status >= 200 && res.status < 300;
              resolve({
                ok,
                status: res.status,
                statusText: res.statusText || '',
                headers: res.responseHeaders,
                text: async () => res.responseText || '',
                json: async () => {
                  if (res.response && typeof res.response === 'object' && !(res.response instanceof ArrayBuffer)) {
                    return res.response;
                  }
                  return JSON.parse(res.responseText);
                },
                arrayBuffer: async () => {
                  if (res.response instanceof ArrayBuffer) {
                    return res.response;
                  }
                  if (res.response && res.response.buffer instanceof ArrayBuffer) {
                    return res.response.buffer;
                  }
                  if (typeof res.responseText === 'string') {
                    const buf = new ArrayBuffer(res.responseText.length);
                    const view = new Uint8Array(buf);
                    for (let i = 0; i < res.responseText.length; i++) {
                      view[i] = res.responseText.charCodeAt(i) & 0xff;
                    }
                    return buf;
                  }
                  return new ArrayBuffer(0);
                }
              });
            },
            onerror: (err) => {
              reject(new Error(`GM_xmlhttpRequest network error: ${err?.statusText || err?.error || 'Request failed'}`));
            },
            ontimeout: () => {
              reject(new Error("GM_xmlhttpRequest request timed out"));
            },
            onabort: () => {
              const err = new Error("GM_xmlhttpRequest request aborted");
              err.name = "AbortError";
              reject(err);
            }
          };

          try {
            const req = GM_xmlhttpRequest(requestDetails);
            if (options.signal && req && typeof req.abort === 'function') {
              options.signal.addEventListener('abort', () => {
                try { req.abort(); } catch (_) {}
              }, { once: true });
            }
          } catch (e) {
            if (typeof fetch === 'function') {
              return fetch(url, options).then(resolve, reject);
            }
            reject(e);
          }
        });
      };
    }

    return (typeof globalThis !== 'undefined' && globalThis.fetch ? globalThis.fetch.bind(globalThis) : null);
  }

  // Cross-tab persistent storage adapter using GM_getValue / GM_setValue
  const gmStorageAdapter = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') ? {
    get: (key) => {
      try {
        return GM_getValue(key, null);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        GM_setValue(key, value);
      } catch {}
    },
    delete: (key) => {
      try {
        if (typeof GM_deleteValue === 'function') {
          GM_deleteValue(key);
        } else {
          GM_setValue(key, null);
        }
      } catch {}
    }
  } : (typeof localStorage !== 'undefined' ? localStorage : null);

  // Instantiate core services
  const fetchFn = createGmFetch();
  const sessionManager = new YandexSessionManager({ fetchFn });
  const summaryCache = new SummaryCache({ storage: gmStorageAdapter });
  const videoSummarizer = new YandexVideoSummarizer({
    sessionManager,
    cache: summaryCache,
    fetchFn
  });

  const controller = new YouTubeController({
    summarizer: videoSummarizer,
    document: typeof document !== 'undefined' ? document : null,
    window: typeof window !== 'undefined' ? window : null
  });

  // Register Tampermonkey toolbar menu commands
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('✨ Пересказать видео (YandexGPT)', () => {
      controller.handleSummarizeClick();
    });
    GM_registerMenuCommand('🗑️ Очистить кэш пересказов', () => {
      summaryCache.clear();
      if (typeof alert === 'function') {
        alert('Кэш пересказов видео успешно очищен.');
      }
    });
  }

  // Bootstrap when YouTube DOM is ready
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => controller.init(), { once: true });
    } else {
      controller.init();
    }
  }

  // Expose API for runtime introspection, debugging, and automated tests
  const publicApi = {
    crypto: { getSubtleCrypto, getSignature, getUUID, getSecYaHeaders, HMAC_SECRET, COMPONENT_VERSION },
    session: { encodeVarint, encodeSessionRequest, decodeSessionResponse, YandexSessionManager },
    cache: { SummaryCache, normalizeCacheKey, DEFAULT_CACHE_TTL_MS },
    client: { YandexVideoSummarizer, extractYouTubeVideoId, canonicalYouTubeUrl, formatTimecode },
    ui: { UI_STYLES, injectStyles, createSummaryButton, injectSummaryButton, SummaryDrawerPanel, YouTubeController, setSafeHTML, clearElement, appendSafeHTML, getTrustedPolicy },
    controller,
    summarizer: videoSummarizer,
    cache: summaryCache,
    createGmFetch
  };

  if (typeof window !== 'undefined') {
    window.__YouTubeSummarizer__ = publicApi;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__YouTubeSummarizer__ = publicApi;
  }
  if (typeof unsafeWindow !== 'undefined') {
    try {
      unsafeWindow.__YouTubeSummarizer__ = publicApi;
    } catch (_) {}
  }

})();

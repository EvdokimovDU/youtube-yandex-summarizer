/**
 * Video Summary In-Memory and Persistent Cache
 * Supports TTL and adapters for localStorage / Tampermonkey GM_getValue / GM_setValue.
 */

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_KEY_PREFIX = 'ya_summary_';

/**
 * Normalizes input key to videoId if a YouTube URL is provided.
 * @param {string} key
 * @returns {string}
 */
export function normalizeCacheKey(key) {
  if (typeof key !== 'string') return String(key || '');
  const trimmed = key.trim();
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:[^&]*&)*v=))([a-zA-Z0-9_-]{11})(?=$|[?&#/])/i
  );
  return match ? match[1] : trimmed;
}

export class SummaryCache {
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

export default SummaryCache;

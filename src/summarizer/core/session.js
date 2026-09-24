/**
 * Lightweight Zero-Dependency Protobuf & Yandex Session Manager
 */

import { textEncoder, textDecoder, getSignature, getUUID } from './crypto.js';

/**
 * Encodes an integer into Protobuf varint bytes.
 * @param {number} value
 * @returns {number[]}
 */
export function encodeVarint(value) {
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
export function encodeSessionRequest(uuid, module = "neuroapi") {
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
export function decodeSessionResponse(rawBytes) {
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
export class YandexSessionManager {
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

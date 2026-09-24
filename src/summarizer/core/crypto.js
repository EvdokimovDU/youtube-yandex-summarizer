/**
 * Protocol and Cryptography Core for Yandex API
 * Web Crypto API implementation supporting both Node.js and Browser environments.
 */

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export const HMAC_SECRET = "bt8xH3VOlb4mqf0nqAibnDOoiPlXsisf";
export const COMPONENT_VERSION = "26.8.3.1002";

let cachedHmacKey = null;

/**
 * Resolves the SubtleCrypto instance across environments (Browser, Node.js, Web Worker).
 * @returns {Promise<SubtleCrypto>}
 */
export async function getSubtleCrypto() {
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
export async function getSignature(body, secretKey = HMAC_SECRET) {
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
export function getUUID() {
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
export async function getSecYaHeaders(secType, session, path) {
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

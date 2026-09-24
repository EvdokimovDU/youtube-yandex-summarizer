/**
 * YouTube Video Summarizer Userscript Build Pipeline
 * Combines modular source files from src/summarizer/ into a single self-contained .user.js bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const USERSCRIPT_METADATA = `// ==UserScript==
// @name         YouTube Video Summarizer (YandexGPT)
// @name:ru      Краткий пересказ видео YouTube (YandexGPT)
// @namespace    https://github.com/Antigravity/youtube-yandex-summarizer
// @version      1.0.2
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
`;

const MODULE_FILES = [
  { name: 'core/crypto.js', label: 'Protocol & Cryptography Core' },
  { name: 'core/session.js', label: 'Protobuf & Session Manager' },
  { name: 'api/cache.js', label: 'Video Summary Cache' },
  { name: 'api/transcript.js', label: 'YouTube Transcript & Subtitles Extractor' },
  { name: 'api/client.js', label: 'Yandex Video Summarizer Client' },
  { name: 'ui/styles.js', label: 'UI Styles & Themes' },
  { name: 'ui/dom-utils.js', label: 'DOM and Trusted Types Safety Utilities' },
  { name: 'ui/button.js', label: 'Action Bar Button Component' },
  { name: 'ui/panel.js', label: 'Sidebar Drawer Panel Component' },
  { name: 'ui/observer.js', label: 'YouTube SPA Observer & Controller' }
];

/**
 * Strips ES module imports and exports to make source code suitable for IIFE bundling.
 * @param {string} code
 * @returns {string}
 */
export function transformModuleToIIFEChunk(code) {
  let cleaned = code;

  // 1. Remove static import statements
  // Handles single line and multiline import { ... } from '...'
  cleaned = cleaned.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');

  // 2. Remove export default statements
  cleaned = cleaned.replace(/^\s*export\s+default\s+[^;]+;?\s*$/gm, '');

  // 3. Remove named export lists: export { a, b, c };
  cleaned = cleaned.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  // 4. Transform exported declarations: export const / let / var / function / async function / class
  cleaned = cleaned.replace(/^\s*export\s+(async\s+function|function|class|const|let|var)\b/gm, '$1');

  // 5. Trim extraneous leading / trailing empty lines
  return cleaned.trim();
}

/**
 * Generates runtime initialization and wiring code inside the userscript IIFE.
 * @returns {string}
 */
export function getRuntimeIntegrationCode() {
  return `
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
              reject(new Error(\`GM_xmlhttpRequest network error: \${err?.statusText || err?.error || 'Request failed'}\`));
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
`;
}

/**
 * Builds the complete standalone Userscript bundle.
 * @returns {string}
 */
export function buildUserscript() {
  const chunks = [];

  for (let i = 0; i < MODULE_FILES.length; i++) {
    const mod = MODULE_FILES[i];
    const filePath = path.join(ROOT_DIR, 'src', 'summarizer', mod.name);
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const transformed = transformModuleToIIFEChunk(rawContent);

    chunks.push(`  // =========================================================================\n` +
                `  // Part ${i + 1}: ${mod.label} (${mod.name})\n` +
                `  // =========================================================================\n\n` +
                transformed.split('\n').map(line => '  ' + line).join('\n'));
  }

  const integrationCode = getRuntimeIntegrationCode();

  const bundle = `${USERSCRIPT_METADATA}\n(function () {\n  'use strict';\n\n` +
                 chunks.join('\n\n') +
                 `\n\n` +
                 integrationCode +
                 `\n})();\n`;

  return bundle;
}

/**
 * Main execution script to write bundle to destination files.
 */
export function runBuild() {
  console.log('=== Building YouTube Video Summarizer Userscript ===\n');

  const bundleContent = buildUserscript();
  const lineCount = bundleContent.split('\n').length;
  const byteSize = Buffer.byteLength(bundleContent, 'utf-8');

  // Outputs
  const rootOutput = path.join(ROOT_DIR, 'youtube-yandex-summarizer.user.js');
  const distDir = path.join(ROOT_DIR, 'dist');
  const distOutput = path.join(distDir, 'youtube-yandex-summarizer.user.js');

  fs.mkdirSync(distDir, { recursive: true });

  fs.writeFileSync(rootOutput, bundleContent, 'utf-8');
  fs.writeFileSync(distOutput, bundleContent, 'utf-8');

  console.log(`✓ Generated: ${path.relative(ROOT_DIR, rootOutput)}`);
  console.log(`✓ Generated: ${path.relative(ROOT_DIR, distOutput)}`);
  console.log(`  Lines: ${lineCount}`);
  console.log(`  Size:  ${(byteSize / 1024).toFixed(2)} KB (${byteSize} bytes)`);
  console.log('\n🎉 Build completed successfully! 🎉\n');
}

// Execute when invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runBuild();
}

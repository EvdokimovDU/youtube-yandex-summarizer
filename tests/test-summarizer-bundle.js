/**
 * Test Suite: Userscript Bundle Verification & Integration Test
 * Verifies that the bundled userscript:
 * 1. Exists at root and dist/ and is non-empty.
 * 2. Has valid Tampermonkey / Greasemonkey metadata headers.
 * 3. Has valid JavaScript syntax via Node.js vm.Script.
 * 4. Runs cleanly in a simulated userscript environment.
 * 5. Bundled components (crypto, session, client, cache, UI, GM_xmlhttpRequest adapter) function properly.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('=== Running YouTube Summarizer Bundle Verification Tests ===\n');

let passedTests = 0;

// Lightweight DOM mock for VM context execution
class MockClassList {
  constructor(el) {
    this._el = el;
    this._classes = new Set();
  }
  add(...names) {
    names.forEach(n => this._classes.add(n));
    this._sync();
  }
  remove(...names) {
    names.forEach(n => this._classes.delete(n));
    this._sync();
  }
  contains(name) {
    return this._classes.has(name);
  }
  toggle(name, force) {
    if (force === true) this._classes.add(name);
    else if (force === false) this._classes.delete(name);
    else {
      if (this._classes.has(name)) this._classes.delete(name);
      else this._classes.add(name);
    }
    this._sync();
    return this._classes.has(name);
  }
  _sync() {
    this._el._className = Array.from(this._classes).join(' ');
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this._className = '';
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this._innerHTML = '';
    this._textContent = '';
    this.disabled = false;
  }

  get className() { return this._className; }
  set className(val) {
    this._className = val || '';
    this.classList._classes.clear();
    if (val) val.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }

  get id() { return this.attributes.get('id') || ''; }
  set id(val) { this.attributes.set('id', val); }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = val;
    if (name === 'class') this.className = val;
  }
  getAttribute(name) { return this.attributes.get(name) || null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  get textContent() { return this._textContent; }
  set textContent(val) { this._textContent = val || ''; }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = val || '';
    this.children = [];
    if (!val) { this._textContent = ''; return; }
    // Minimal mock parser
    const tags = val.match(/<([a-zA-Z0-9-]+)([^>]*)>/g) || [];
    for (const tag of tags) {
      const match = tag.match(/<([a-zA-Z0-9-]+)([^>]*)>/);
      if (match && !match[1].startsWith('/')) {
        const child = new MockElement(match[1]);
        const classMatch = match[2].match(/class=["']([^"']*)["']/);
        if (classMatch) child.className = classMatch[1];
        const idMatch = match[2].match(/id=["']([^"']*)["']/);
        if (idMatch) child.id = idMatch[1];
        this.children.push(child);
        child.parentElement = this;
      }
    }
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  prepend(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  removeEventListener(event, fn) {
    if (this.listeners.has(event)) {
      const list = this.listeners.get(event);
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    }
  }
  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) h.call(this, event);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {}, stopPropagation: () => {} });
  }

  querySelector(selector) {
    return this._query(selector, false);
  }
  querySelectorAll(selector) {
    const results = [];
    this._query(selector, true, results);
    return results;
  }
  _query(selector, all, results = []) {
    for (const child of this.children) {
      let isMatch = false;
      if (selector.startsWith('#') && child.id === selector.slice(1)) isMatch = true;
      else if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) isMatch = true;
      else if (selector.toLowerCase() === child.tagName.toLowerCase()) isMatch = true;

      if (isMatch) {
        if (!all) return child;
        results.push(child);
      }
      const nested = child._query(selector, all, results);
      if (!all && nested) return nested;
    }
    return all ? results : null;
  }
}

async function runTests() {
  // =========================================================================
  // Test 1: Output File Existence and Non-Empty Check
  // =========================================================================
  console.log('Test 1: Output bundle files exist and are non-empty');
  const rootBundlePath = path.join(ROOT_DIR, 'youtube-yandex-summarizer.user.js');
  const distBundlePath = path.join(ROOT_DIR, 'dist', 'youtube-yandex-summarizer.user.js');

  assert.ok(fs.existsSync(rootBundlePath), 'Root bundle youtube-yandex-summarizer.user.js must exist');
  assert.ok(fs.existsSync(distBundlePath), 'Dist bundle dist/youtube-yandex-summarizer.user.js must exist');

  const rootContent = fs.readFileSync(rootBundlePath, 'utf-8');
  const distContent = fs.readFileSync(distBundlePath, 'utf-8');

  assert.ok(rootContent.length > 10000, `Root bundle size too small: ${rootContent.length} bytes`);
  assert.strictEqual(rootContent, distContent, 'Root bundle and dist bundle must have identical contents');
  console.log(`✓ Test 1 passed: Both bundle files exist and are identical (${(Buffer.byteLength(rootContent) / 1024).toFixed(2)} KB)`);
  passedTests++;

  // =========================================================================
  // Test 2: Userscript Metadata Header Validation
  // =========================================================================
  console.log('\nTest 2: Bundle contains valid and complete Userscript metadata headers');
  const expectedHeaders = [
    '// ==UserScript==',
    '// ==/UserScript==',
    '@name         YouTube Video Summarizer (YandexGPT)',
    '@name:ru      Краткий пересказ видео YouTube (YandexGPT)',
    '@namespace    https://github.com/Antigravity/youtube-yandex-summarizer',
    '@version      1.0.3',
    '@match        *://*.youtube.com/*',
    '@run-at       document-idle',
    '@grant        GM_xmlhttpRequest',
    '@grant        GM_getValue',
    '@grant        GM_setValue',
    '@grant        GM_registerMenuCommand',
    '@connect      300.ya.ru',
    '@connect      api.browser.yandex.ru',
    '@connect      www.youtube.com'
  ];

  for (const header of expectedHeaders) {
    assert.ok(
      rootContent.includes(header),
      `Bundle is missing required metadata header: "${header}"`
    );
  }
  console.log('✓ Test 2 passed: All required Userscript metadata headers are present');
  passedTests++;

  // =========================================================================
  // Test 3: JavaScript Syntax Validation via vm.Script
  // =========================================================================
  console.log('\nTest 3: Bundle JavaScript syntax compiles cleanly via Node.js vm.Script');
  let script;
  assert.doesNotThrow(() => {
    script = new vm.Script(rootContent, {
      filename: 'youtube-yandex-summarizer.user.js',
      lineOffset: 0
    });
  }, 'Bundled userscript must be valid JavaScript without syntax errors');
  assert.ok(script instanceof vm.Script, 'Script compiled to vm.Script successfully');
  console.log('✓ Test 3 passed: Script syntax parsed and compiled without any errors');
  passedTests++;

  // =========================================================================
  // Test 4: Runtime Execution & Component Verification in VM Context
  // =========================================================================
  console.log('\nTest 4: Bundle executes cleanly in simulated userscript sandbox');

  // Simulated browser & Tampermonkey environment
  const mockStorage = new Map();
  const menuCommands = [];
  let gmXmlHttpRequestCalls = [];

  const mockDoc = {
    head: new MockElement('head'),
    body: new MockElement('body'),
    readyState: 'complete',
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => mockDoc.body.querySelector(`#${id}`),
    querySelector: (sel) => {
      if (sel === 'body') return mockDoc.body;
      if (sel === 'head') return mockDoc.head;
      return mockDoc.body.querySelector(sel);
    },
    querySelectorAll: (sel) => mockDoc.body.querySelectorAll(sel),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const mockWin = {
    location: {
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ'
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {}
  };

  const sandboxContext = {
    window: mockWin,
    document: mockDoc,
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
      clipboard: { writeText: async () => {} }
    },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {}
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    JSON,
    Promise,
    Error,
    Math,
    Date,
    // Crypto
    crypto: globalThis.crypto,
    // Tampermonkey grants
    GM_getValue: (key, def) => mockStorage.has(key) ? mockStorage.get(key) : def,
    GM_setValue: (key, val) => mockStorage.set(key, val),
    GM_registerMenuCommand: (caption, fn) => menuCommands.push({ caption, fn }),
    GM_xmlhttpRequest: (details) => {
      gmXmlHttpRequestCalls.push(details);
      // Simulate successful immediate response
      if (typeof details.onload === 'function') {
        setTimeout(() => {
          details.onload({
            status: 200,
            statusText: 'OK',
            responseText: JSON.stringify({ status_code: 0, title: 'Mocked Bundle Summary', keypoints: [] }),
            responseHeaders: 'Content-Type: application/json'
          });
        }, 10);
      }
      return { abort: () => {} };
    }
  };

  sandboxContext.globalThis = sandboxContext;
  vm.createContext(sandboxContext);

  // Execute bundled code inside VM sandbox
  script.runInContext(sandboxContext);

  const api = sandboxContext.window.__YouTubeSummarizer__ || sandboxContext.__YouTubeSummarizer__;
  assert.ok(api, '__YouTubeSummarizer__ public API must be exposed on window/globalThis');
  assert.ok(api.crypto, 'API must expose crypto module');
  assert.ok(api.session, 'API must expose session module');
  assert.ok(api.cache, 'API must expose cache module');
  assert.ok(api.client, 'API must expose client module');
  assert.ok(api.ui, 'API must expose ui module');
  assert.ok(api.controller, 'API must expose controller instance');
  assert.ok(api.summarizer, 'API must expose summarizer instance');
  assert.ok(api.createGmFetch, 'API must expose createGmFetch');

  console.log('✓ Test 4 passed: Userscript executed in sandbox and exposed public API');
  passedTests++;

  // =========================================================================
  // Test 5: Functional Verification of Bundled Modules
  // =========================================================================
  console.log('\nTest 5: Functional verification of all bundled components');

  // 5a. Crypto
  const uuid = api.crypto.getUUID();
  assert.strictEqual(typeof uuid, 'string');
  assert.strictEqual(uuid.length, 32);
  assert.match(uuid, /^[0-9A-F]{32}$/);

  const sig = await api.crypto.getSignature('test');
  assert.strictEqual(sig, 'ef02ef65d4b0c97334b2e2840177ba354f5b7e530200636dfe5b969eda9442e4');

  // 5b. Protobuf Session
  const encoded = api.session.encodeSessionRequest(uuid, 'neuroapi');
  assert.ok(encoded instanceof Uint8Array);
  assert.strictEqual(encoded[0], 0x0a);

  const secretBytes = Array.from(new TextEncoder().encode('sk_bundled_test'));
  const syntheticResponse = new Uint8Array([0x0a, secretBytes.length, ...secretBytes, 0x10, 0x90, 0x1c]);
  const decoded = api.session.decodeSessionResponse(syntheticResponse);
  assert.strictEqual(decoded.secretKey, 'sk_bundled_test');
  assert.strictEqual(decoded.expires, 3600);

  // 5c. Client helpers
  const extractedId = api.client.extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(extractedId, 'dQw4w9WgXcQ');
  assert.strictEqual(api.client.canonicalYouTubeUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(api.client.formatTimecode(125), '02:05');
  assert.strictEqual(api.client.formatTimecode(3665), '01:01:05');

  // 5d. Cache with GM_getValue / GM_setValue persistence
  const cache = api.cache;
  cache.set('test_vid', { title: 'Cached in GM storage' });
  assert.strictEqual(cache.has('test_vid'), true);
  assert.deepStrictEqual(cache.get('test_vid'), { title: 'Cached in GM storage' });
  // Verify persistent adapter was called
  assert.ok(mockStorage.has('ya_summary_test_vid'), 'GM_setValue must have persisted cache key');

  // 5e. Tampermonkey Menu Commands
  assert.strictEqual(menuCommands.length, 2, 'Must register 2 menu commands in Tampermonkey');
  assert.ok(menuCommands[0].caption.includes('Пересказать'), 'Menu command 1 must be summarization');
  assert.ok(menuCommands[1].caption.includes('Очистить кэш'), 'Menu command 2 must be clear cache');

  // 5f. GM_xmlhttpRequest fetch adaptor
  const gmFetch = api.createGmFetch();
  const fetchResponse = await gmFetch('https://300.ya.ru/api/neuro/generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' })
  });

  assert.strictEqual(fetchResponse.ok, true);
  assert.strictEqual(fetchResponse.status, 200);
  const json = await fetchResponse.json();
  assert.strictEqual(json.status_code, 0);
  assert.strictEqual(json.title, 'Mocked Bundle Summary');
  assert.strictEqual(gmXmlHttpRequestCalls.length, 1);
  assert.strictEqual(gmXmlHttpRequestCalls[0].url, 'https://300.ya.ru/api/neuro/generation');

  // 5g. UI Components
  assert.ok(api.ui.UI_STYLES.includes('.yt-summary-drawer'));
  assert.ok(api.ui.UI_STYLES.includes('.yt-summary-btn'));

  const btnObj = api.ui.createSummaryButton({ doc: mockDoc });
  assert.ok(btnObj.getElement() instanceof MockElement);
  btnObj.setLoading(true);
  assert.strictEqual(btnObj.getElement().classList.contains('loading'), true);

  console.log('✓ Test 5 passed: All bundled modules and GM adaptors function flawlessly');
  passedTests++;

  console.log(`\n🎉 ALL ${passedTests} BUNDLE TESTS PASSED SUCCESSFULLY! 🎉`);
}

runTests().catch(err => {
  console.error('\n❌ Bundle test failed with error:', err);
  process.exit(1);
});

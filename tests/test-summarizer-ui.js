/**
 * YouTube Summarizer UI Unit & Integration Tests
 * Runs in Node.js environment with a lightweight DOM mock.
 */

import assert from 'node:assert';

// Mock minimal DOM environment for Node.js
class MockClassList {
  constructor(element) {
    this._classes = new Set();
    this._element = element;
  }
  add(...names) {
    names.forEach(n => this._classes.add(n));
    this._updateClassName();
  }
  remove(...names) {
    names.forEach(n => this._classes.delete(n));
    this._updateClassName();
  }
  toggle(name, force) {
    if (force === true) {
      this._classes.add(name);
    } else if (force === false) {
      this._classes.delete(name);
    } else {
      if (this._classes.has(name)) this._classes.delete(name);
      else this._classes.add(name);
    }
    this._updateClassName();
    return this._classes.has(name);
  }
  contains(name) {
    return this._classes.has(name);
  }
  _updateClassName() {
    this._element._className = Array.from(this._classes).join(' ');
  }
  _syncFromClassName(className) {
    this._classes.clear();
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this._className = '';
    this.classList = new MockClassList(this);
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this._innerHTML = '';
    this._textContent = '';
    this.disabled = false;
    this.title = '';
    this.currentTime = 0;
    this.paused = true;
  }

  get textContent() {
    const childTexts = this.children.map(c => c.textContent).filter(Boolean).join(' ');
    if (this._textContent && childTexts) {
      return `${this._textContent} ${childTexts}`;
    }
    return childTexts || this._textContent || '';
  }

  set textContent(val) {
    this._textContent = val || '';
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val || '';
    this.classList._syncFromClassName(this._className);
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  set id(val) {
    this.attributes.set('id', val);
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = val;
    if (name === 'class') this.className = val;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
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
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
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
    event.target = this;
    for (const h of handlers) {
      h.call(this, event);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {}, stopPropagation: () => {} });
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    if (!html) {
      this.textContent = '';
      return;
    }
    this._parseSimpleHTML(html);
  }

  _parseSimpleHTML(html) {
    const tokenRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*?)(\/)?>|([^<]+)/g;
    let match;
    const stack = [this];

    while ((match = tokenRegex.exec(html)) !== null) {
      if (match[0].startsWith('<!--')) continue;

      const isClosing = match[1] === '/';
      const tagName = match[2];
      const attrsStr = match[3] || '';
      const isSelfClosing = match[4] === '/' || ['path', 'polygon', 'circle', 'img', 'br', 'hr', 'input'].includes(tagName?.toLowerCase());
      const text = match[5];

      if (text) {
        const trimmed = text.trim();
        if (trimmed) {
          const current = stack[stack.length - 1];
          if (current) {
            current._textContent = (current._textContent ? current._textContent + ' ' : '') + trimmed;
          }
        }
      } else if (tagName) {
        if (isClosing) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName.toLowerCase() === tagName.toLowerCase()) {
              stack.splice(i, stack.length - i);
              break;
            }
          }
        } else {
          const child = new MockElement(tagName);
          const classMatch = attrsStr.match(/class=["']([^"']*)["']/);
          if (classMatch) child.className = classMatch[1];

          const idMatch = attrsStr.match(/id=["']([^"']*)["']/);
          if (idMatch) child.id = idMatch[1];

          const titleMatch = attrsStr.match(/title=["']([^"']*)["']/);
          if (titleMatch) child.title = titleMatch[1];

          const current = stack[stack.length - 1];
          if (current) current.appendChild(child);

          if (!isSelfClosing) {
            stack.push(child);
          }
        }
      }
    }
  }

  querySelector(selector) {
    return this._matchSelector(selector, false);
  }

  querySelectorAll(selector) {
    const results = [];
    this._matchSelector(selector, true, results);
    return results;
  }

  _matchSelector(selector, all = false, results = []) {
    for (const child of this.children) {
      let isMatch = false;
      if (selector.startsWith('#')) {
        isMatch = child.id === selector.slice(1);
      } else if (selector.startsWith('.')) {
        isMatch = child.classList.contains(selector.slice(1));
      } else if (selector.toLowerCase() === child.tagName.toLowerCase()) {
        isMatch = true;
      }

      if (isMatch) {
        if (!all) return child;
        results.push(child);
      }

      const nested = child._matchSelector(selector, all, results);
      if (!all && nested) return nested;
    }
    return all ? results : null;
  }
}

// Global environment setup for tests
const mockDocument = {
  head: new MockElement('head'),
  body: new MockElement('body'),
  createElement(tag) {
    return new MockElement(tag);
  },
  querySelector(sel) {
    if (sel === 'body') return this.body;
    if (sel === 'head') return this.head;
    return this.body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  },
  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
};

let clipboardContent = '';
const mockNavigator = {
  clipboard: {
    writeText: async (text) => {
      clipboardContent = text;
      return Promise.resolve();
    }
  }
};

const mockWindow = {
  location: {
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    pathname: '/watch',
    search: '?v=dQw4w9WgXcQ'
  },
  listeners: new Map(),
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  },
  removeEventListener(event, fn) {
    if (this.listeners.has(event)) {
      const list = this.listeners.get(event);
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    }
  },
  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) fn.call(this, event);
  }
};

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = false;
  }
  observe(target, options) {
    this.observed = true;
  }
  disconnect() {
    this.observed = false;
  }
}

globalThis.document = mockDocument;
globalThis.window = mockWindow;
Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: mockNavigator.clipboard,
  configurable: true,
  writable: true
});
globalThis.MutationObserver = MockMutationObserver;

// Dynamic imports to test modules
console.log('=== Running YouTube Summarizer UI & Controller Tests ===\n');

let passedTests = 0;

async function runTests() {
  // -------------------------------------------------------------
  // Test 1: UI Styles Export & Format
  // -------------------------------------------------------------
  console.log('Test 1: styles.js exports UI_STYLES with YouTube themes and component CSS');
  const { UI_STYLES } = await import('../src/summarizer/ui/styles.js');

  assert.strictEqual(typeof UI_STYLES, 'string', 'UI_STYLES must be a string');
  assert.ok(UI_STYLES.includes('--yt-spec-base-background'), 'Must reference YouTube CSS variables');
  assert.ok(UI_STYLES.includes('.yt-summary-btn'), 'Must contain .yt-summary-btn styles');
  assert.ok(UI_STYLES.includes('.yt-summary-drawer'), 'Must contain .yt-summary-drawer styles');
  assert.ok(UI_STYLES.includes('.yt-summary-timecode'), 'Must contain .yt-summary-timecode styles');
  assert.ok(UI_STYLES.includes('.yt-summary-badge'), 'Must contain .yt-summary-badge styles');
  assert.ok(UI_STYLES.includes('.yt-summary-theses'), 'Must contain .yt-summary-theses styles');

  console.log('✓ Test 1 passed: UI_STYLES contains all necessary CSS declarations');
  passedTests++;

  // -------------------------------------------------------------
  // Test 2: Button Creation & State
  // -------------------------------------------------------------
  console.log('\nTest 2: button.js creates button with YouTube style, icon, label, and reactive states');
  const { createSummaryButton, injectSummaryButton } = await import('../src/summarizer/ui/button.js');

  let clickCount = 0;
  const button = createSummaryButton({
    onClick: () => { clickCount++; }
  });

  const btnEl = button.getElement();
  assert.ok(btnEl instanceof MockElement, 'Button element must be an element');
  assert.ok(btnEl.classList.contains('yt-summary-btn'), 'Must have yt-summary-btn class');
  assert.ok(btnEl.innerHTML.includes('svg') || btnEl.querySelector('svg'), 'Must include SVG icon');
  assert.ok(btnEl.textContent.includes('Пересказ') || btnEl.innerHTML.includes('Пересказ'), 'Must include "Пересказ" label');

  // Click triggers callback
  btnEl.click();
  assert.strictEqual(clickCount, 1, 'Clicking button triggers onClick handler');

  // Loading state
  button.setLoading(true);
  assert.ok(btnEl.classList.contains('loading'), 'setLoading(true) should add loading class');
  assert.strictEqual(btnEl.disabled, true, 'setLoading(true) should disable button');

  button.setLoading(false);
  assert.strictEqual(btnEl.classList.contains('loading'), false, 'setLoading(false) removes loading class');
  assert.strictEqual(btnEl.disabled, false, 'setLoading(false) enables button');

  // Active state
  button.setActive(true);
  assert.ok(btnEl.classList.contains('active'), 'setActive(true) should add active class');
  button.setActive(false);
  assert.strictEqual(btnEl.classList.contains('active'), false, 'setActive(false) removes active class');

  console.log('✓ Test 2 passed: createSummaryButton creates element with proper states and interactions');
  passedTests++;

  // -------------------------------------------------------------
  // Test 3: Button Injection & Duplicate Prevention
  // -------------------------------------------------------------
  console.log('\nTest 3: injectSummaryButton mounts button into YouTube action bar without duplicates');
  const container = mockDocument.createElement('div');
  container.id = 'top-level-buttons-computed';
  mockDocument.body.appendChild(container);

  const mounted1 = injectSummaryButton(btnEl);
  assert.strictEqual(mounted1, true, 'First injection should succeed');
  assert.ok(container.children.includes(btnEl), 'Container must contain injected button');

  // Attempt duplicate injection
  const mounted2 = injectSummaryButton(btnEl);
  assert.strictEqual(mounted2, true, 'Subsequent call should detect existing or retain single instance');
  const matches = mockDocument.querySelectorAll('.yt-summary-btn');
  assert.strictEqual(matches.length, 1, 'Should never mount duplicate buttons');

  console.log('✓ Test 3 passed: injectSummaryButton correctly targets container and avoids duplicates');
  passedTests++;

  // -------------------------------------------------------------
  // Test 4: Panel Drawer Lifecycle & Dragging
  // -------------------------------------------------------------
  console.log('\nTest 4: panel.js SummaryDrawerPanel manages lifecycle (show, hide, toggle, drag)');
  const { SummaryDrawerPanel } = await import('../src/summarizer/ui/panel.js');

  const panel = new SummaryDrawerPanel({
    container: mockDocument.body
  });

  const drawerEl = mockDocument.querySelector('.yt-summary-drawer');
  assert.ok(drawerEl, 'Drawer element must be created and attached to DOM');
  assert.strictEqual(panel.isOpen(), false, 'Panel should be closed initially');

  panel.show();
  assert.strictEqual(panel.isOpen(), true, 'panel.show() opens drawer');
  assert.ok(drawerEl.classList.contains('open'), 'Drawer element has open class');

  panel.hide();
  assert.strictEqual(panel.isOpen(), false, 'panel.hide() closes drawer');
  assert.strictEqual(drawerEl.classList.contains('open'), false, 'Drawer does not have open class');

  panel.toggle();
  assert.strictEqual(panel.isOpen(), true, 'panel.toggle() toggles drawer to open');

  // Verify header and close button
  const header = drawerEl.querySelector('.yt-summary-drawer-header');
  assert.ok(header, 'Drawer must have a header');
  const closeBtn = drawerEl.querySelector('.yt-summary-btn-close');
  assert.ok(closeBtn, 'Drawer must have a close button');
  closeBtn.click();
  assert.strictEqual(panel.isOpen(), false, 'Clicking close button closes drawer');

  console.log('✓ Test 4 passed: SummaryDrawerPanel show/hide/toggle and close button function correctly');
  passedTests++;

  // -------------------------------------------------------------
  // Test 5: Panel Rendering - Loading, Summary, Error states
  // -------------------------------------------------------------
  console.log('\nTest 5: SummaryDrawerPanel renders loading, summary (with timecode click), and error states');
  panel.show();

  // 5a. Loading state
  panel.setLoading({ approximateWaitingTime: 15, status: 'progress' });
  const content = drawerEl.querySelector('.yt-summary-drawer-content');
  assert.ok(content.querySelector('.yt-summary-loading'), 'Must render loading view');
  assert.ok(content.textContent.includes('15') || content.innerHTML.includes('15') || content.textContent.includes('пересказ'), 'Loading info displayed');

  // 5b. Summary state
  const mockSummaryData = {
    title: 'Тестовое видео про ИИ',
    keypoints: [
      {
        startTime: 10,
        timecode: '00:10',
        title: 'Вступление',
        theses: ['Что такое нейросети', 'Краткая история']
      },
      {
        startTime: 125,
        timecode: '02:05',
        title: 'Архитектура трансформеров',
        theses: ['Механизм внимания']
      }
    ]
  };

  let clickedTime = null;
  panel.renderSummary(mockSummaryData, (time) => {
    clickedTime = time;
  });

  const chapters = content.querySelectorAll('.yt-summary-chapter');
  assert.strictEqual(chapters.length, 2, 'Must render 2 chapter elements');

  // Check timecode chip click
  const timecodes = content.querySelectorAll('.yt-summary-timecode');
  assert.strictEqual(timecodes.length, 2, 'Must render 2 timecode buttons/chips');
  assert.ok(timecodes[0].textContent.includes('00:10'), 'First timecode contains 00:10');

  timecodes[1].click();
  assert.strictEqual(clickedTime, 125, 'Clicking second timecode triggers callback with startTime 125');

  // 5c. Error state and retry
  let retryTriggered = false;
  panel.renderError('Не удалось получить пересказ', () => {
    retryTriggered = true;
  });

  const errorEl = content.querySelector('.yt-summary-error');
  assert.ok(errorEl, 'Must render error element');
  assert.ok(errorEl.textContent.includes('Не удалось получить пересказ'), 'Must display error message');

  const retryBtn = content.querySelector('.yt-summary-retry-btn');
  assert.ok(retryBtn, 'Must render retry button');
  retryBtn.click();
  assert.strictEqual(retryTriggered, true, 'Clicking retry button triggers onRetry callback');

  console.log('✓ Test 5 passed: SummaryDrawerPanel renders loading, summary, timecodes, and errors correctly');
  passedTests++;

  // -------------------------------------------------------------
  // Test 6: Text Formatting and Clipboard Copying
  // -------------------------------------------------------------
  console.log('\nTest 6: SummaryDrawerPanel formats plain text and copies to clipboard');
  panel.renderSummary(mockSummaryData);

  clipboardContent = '';
  const copyBtn = drawerEl.querySelector('.yt-summary-btn-copy');
  assert.ok(copyBtn, 'Drawer must have a copy button');
  copyBtn.click();

  assert.ok(clipboardContent.length > 0, 'Clipboard must receive copied text');
  assert.ok(clipboardContent.includes('Тестовое видео про ИИ'), 'Copied text must include title');
  assert.ok(clipboardContent.includes('[00:10] Вступление'), 'Copied text must include timecodes and chapter title');
  assert.ok(clipboardContent.includes('• Что такое нейросети'), 'Copied text must include thesis bullet');
  assert.ok(clipboardContent.includes('[02:05] Архитектура трансформеров'), 'Copied text must include second chapter');

  console.log('✓ Test 6 passed: Plain text summary properly formatted and copied to clipboard');
  passedTests++;

  // -------------------------------------------------------------
  // Test 7: YouTubeController Video Seeking & SPA Navigation
  // -------------------------------------------------------------
  console.log('\nTest 7: YouTubeController handles video seeking, SPA page transitions, and summarization flow');
  const { YouTubeController } = await import('../src/summarizer/ui/observer.js');

  // Setup mock video element
  const videoEl = mockDocument.createElement('video');
  videoEl.className = 'html5-main-video';
  mockDocument.body.appendChild(videoEl);

  let summarizeCalledWith = null;
  const mockSummarizer = {
    summarizeVideo: async (url, opts) => {
      summarizeCalledWith = url;
      opts?.onProgress?.({ status: 'progress', statusCode: 1 });
      return mockSummaryData;
    }
  };

  const controller = new YouTubeController({
    summarizer: mockSummarizer,
    window: mockWindow,
    document: mockDocument
  });

  controller.init();

  // 7a. Video seeking
  controller.seekTo(75);
  assert.strictEqual(videoEl.currentTime, 75, 'seekTo sets video.currentTime to target seconds');
  assert.strictEqual(videoEl.paused, false, 'seekTo calls video.play()');

  // 7b. Watch page detection
  assert.strictEqual(controller.isWatchPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(controller.isWatchPage('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
  assert.strictEqual(controller.isWatchPage('https://www.youtube.com/feed/subscriptions'), false);

  // 7c. Button click starts summarization flow
  await controller.handleSummarizeClick();
  assert.strictEqual(summarizeCalledWith, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(controller.panel.isOpen(), true, 'Panel must open upon summarization');

  // 7d. Navigation to another video resets state
  mockWindow.location.href = 'https://www.youtube.com/watch?v=abcdefghijk';
  mockWindow.dispatchEvent({ type: 'yt-navigate-finish' });
  assert.strictEqual(controller.button.getElement().classList.contains('active'), false, 'Navigating to new video resets active state');

  controller.destroy();
  console.log('✓ Test 7 passed: YouTubeController integrates player seeking, SPA changes, and summarization');
  passedTests++;

  console.log(`\n🎉 ALL ${passedTests} UI TESTS PASSED SUCCESSFULLY! 🎉`);
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});

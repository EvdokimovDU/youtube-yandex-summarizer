/**
 * YouTube Summarizer Sidebar Drawer Panel Component.
 * Supports smooth slide-in/out, horizontal dragging, loading skeleton,
 * chapter timecodes with seek callback, and plain text copying.
 */

import { setSafeHTML, clearElement } from './dom-utils.js';

const ICONS = {
  SPARKLES: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>`,
  COPY: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
  CHECK: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  CLOSE: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  PLAY: `<svg viewBox="0 0 24 24" width="10" height="10"><polygon fill="currentColor" points="6 4 20 12 6 20 6 4"/></svg>`,
  ERROR: `<svg viewBox="0 0 24 24" width="40" height="40"><path fill="#e53935" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`
};

export class SummaryDrawerPanel {
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
    this.currentSummary = summaryData;
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
      lines.push(this.currentSummary.title);
      lines.push('');
    }

    if (Array.isArray(this.currentSummary.keypoints)) {
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

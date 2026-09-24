/**
 * YouTube Page Navigation Observer & Controller.
 * Manages SPA navigation events (yt-navigate-finish, spfdone, popstate),
 * button injection lifecycle, player seeking, and summarizer coordination.
 */

import { extractYouTubeVideoId, YandexVideoSummarizer } from '../api/client.js';
import { injectStyles } from './styles.js';
import { createSummaryButton, injectSummaryButton } from './button.js';
import { SummaryDrawerPanel } from './panel.js';
import { appendSafeHTML } from './dom-utils.js';

export class YouTubeController {
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

export default YouTubeController;

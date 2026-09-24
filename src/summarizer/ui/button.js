/**
 * YouTube Action Bar Button Component & DOM Injector.
 * Matches YouTube's native action bar button styles (pill shape, icon, hover, active).
 */

import { appendSafeHTML } from './dom-utils.js';

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
export function createSummaryButton({ onClick, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
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
export function injectSummaryButton(buttonEl, doc = (typeof document !== 'undefined' ? document : null)) {
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

  // 1. Try to place directly next to YouTube's Like/Dislike segmented button
  const likeBtn = doc.querySelector ? doc.querySelector(
    'ytd-segmented-like-dislike-button-renderer, ' +
    'segmented-like-dislike-button-view-model, ' +
    'like-button-view-model, ' +
    '#segmented-like-button'
  ) : null;
  if (likeBtn && likeBtn.parentElement) {
    try {
      likeBtn.parentElement.insertBefore(buttonEl, likeBtn);
      return true;
    } catch (_) {}
  }

  // 2. Potential target containers on YouTube watch / shorts pages
  const targetSelectors = [
    '#top-level-buttons-computed',
    'ytd-menu-renderer #top-level-buttons-computed',
    'ytd-watch-metadata #actions #top-level-buttons-computed',
    'ytd-watch-metadata #top-row #actions #top-level-buttons-computed',
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
    if (container) {
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

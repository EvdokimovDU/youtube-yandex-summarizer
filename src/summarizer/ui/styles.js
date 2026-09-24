/**
 * CSS stylesheet and injection helper for YouTube Video Summarizer UI.
 * Adapts to YouTube dark and light themes seamlessly via CSS variables.
 */

export const UI_STYLES = `
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
export function injectStyles(doc = (typeof document !== 'undefined' ? document : null)) {
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

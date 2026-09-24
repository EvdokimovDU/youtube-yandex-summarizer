/**
 * DOM & Trusted Types Utility Helpers.
 * YouTube strictly enforces Trusted Types (CSP require-trusted-types-for 'script').
 * Direct assignment to .innerHTML throws:
 * "TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment."
 *
 * This module provides safe, CSP-compliant DOM manipulation using:
 * 1. Direct assignment when permitted (e.g. Node.js mock DOM or non-restricted environments).
 * 2. window.trustedTypes policy when available.
 * 3. DOMParser + Document.importNode fallback (bypasses TrustedHTML sinks on Chrome/YouTube).
 * 4. Safe element clearing without innerHTML = ''.
 */

let trustedPolicy = null;
let policyAttempted = false;

/**
 * Lazily obtains or creates a Trusted Types policy.
 * @returns {TrustedTypePolicy | { createHTML: (s: string) => string } | null}
 */
export function getTrustedPolicy() {
  if (policyAttempted) return trustedPolicy;
  policyAttempted = true;

  const tt = typeof window !== 'undefined' ? (window.trustedTypes || globalThis.trustedTypes) : null;
  if (!tt || typeof tt.createPolicy !== 'function') {
    return null;
  }

  // Attempt custom policy name first
  try {
    trustedPolicy = tt.createPolicy('youtube-summarizer', {
      createHTML: (s) => s
    });
    return trustedPolicy;
  } catch (_) {}

  // Attempt default policy fallback
  try {
    trustedPolicy = tt.createPolicy('default', {
      createHTML: (s) => s
    });
    return trustedPolicy;
  } catch (_) {}

  // If already exists, return default policy
  try {
    if (tt.defaultPolicy) {
      trustedPolicy = tt.defaultPolicy;
      return trustedPolicy;
    }
  } catch (_) {}

  return null;
}

/**
 * Safely removes all child nodes from an element without setting innerHTML = ''.
 * @param {HTMLElement} element
 */
export function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  if (element.children && element.children.length > 0) {
    while (element.children.length > 0) {
      element.removeChild(element.children[0]);
    }
  }
}

/**
 * Safely sets HTML content on an element, complying with YouTube's Trusted Types CSP.
 *
 * @param {HTMLElement} element Target container
 * @param {string} htmlString HTML markup string
 * @param {Document} [doc=document] Document context
 */
export function setSafeHTML(element, htmlString, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!element) return;

  // 1. Try direct assignment (succeeds in mock environments or non-restricted contexts)
  try {
    element.innerHTML = htmlString;
    return;
  } catch (_) {
    // Caught TrustedHTML assignment error: fall through to DOMParser & Trusted Types
  }

  // 2. Try Trusted Types policy if available
  const policy = getTrustedPolicy();
  if (policy && typeof policy.createHTML === 'function') {
    try {
      element.innerHTML = policy.createHTML(htmlString);
      return;
    } catch (_) {}
  }

  // 3. Fallback: Parse via DOMParser and append imported nodes (bypasses innerHTML sink)
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(htmlString, 'text/html');
      clearElement(element);

      const targetDoc = doc || element.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const childNodes = Array.from(parsedDoc.body.childNodes);

      for (const node of childNodes) {
        const imported = targetDoc && typeof targetDoc.importNode === 'function'
          ? targetDoc.importNode(node, true)
          : node;
        element.appendChild(imported);
      }
      return;
    }
  } catch (_) {}

  // 4. Last-ditch text fallback
  element.textContent = htmlString;
}

/**
 * Safely appends HTML markup to an element without clearing existing children.
 *
 * @param {HTMLElement} element Target container
 * @param {string} htmlString HTML markup string
 * @param {Document} [doc=document] Document context
 */
export function appendSafeHTML(element, htmlString, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!element) return;

  // 1. If in browser with DOMParser, parse and append directly without innerHTML sink
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(htmlString, 'text/html');
      const targetDoc = doc || element.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const childNodes = Array.from(parsedDoc.body.childNodes);

      if (childNodes.length > 0) {
        for (const node of childNodes) {
          const imported = targetDoc && typeof targetDoc.importNode === 'function'
            ? targetDoc.importNode(node, true)
            : node;
          element.appendChild(imported);
        }
        return;
      }
    } catch (_) {}
  }

  // 2. Mock environment or fallback: transfer via temporary container
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
  const temp = targetDoc ? targetDoc.createElement('div') : null;
  if (temp) {
    setSafeHTML(temp, htmlString, doc);
    while (temp.firstChild || (temp.children && temp.children.length > 0)) {
      const child = temp.firstChild || temp.children[0];
      element.appendChild(child);
    }
    return;
  }

  try {
    element.innerHTML += htmlString;
  } catch (_) {
    element.textContent += htmlString;
  }
}

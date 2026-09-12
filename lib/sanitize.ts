/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * XSS Sanitation Utility
 * Wraps DOMPurify to sanitize HTML before rendering with dangerouslySetInnerHTML
 */

import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize HTML string for safe rendering in dangerouslySetInnerHTML
 * Uses isomorphic-dompurify to work safely on both server and client.
 */
export function sanitizeHTML(html: string, windowRef?: Window): string {
  // windowRef is ignored since isomorphic-dompurify handles the DOM automatically.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel'],
    ADD_ATTR: ['target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as string;
}

/**
 * Server-side safe sanitize — strips all tags safely using DOMPurify
 */
export function sanitizeHTMLServer(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [], // Strip all tags
    ALLOWED_ATTR: []
  }) as string;
}

/**
 * Safely open a user-supplied URL in a new tab.
 *
 * Validates that the URL uses an http/https scheme before opening to prevent
 * dangerous schemes (e.g. `javascript:`) from executing. Also passes
 * `noopener,noreferrer` window features to prevent reverse-tabnabbing.
 * No-ops for empty, malformed, or non-http(s) URLs.
 */
export function openExternalUrl(url: string | null | undefined): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
}

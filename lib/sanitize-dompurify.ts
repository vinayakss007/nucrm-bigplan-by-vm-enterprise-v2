/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Client-side HTML sanitization using DOMPurify.
 *
 * This module imports `isomorphic-dompurify` at the top level, so it must
 * only be imported from client components (browser runtime). Server-side
 * code (cron, API routes) must use `sanitizeHTMLServer` from
 * `lib/sanitize.ts` instead, which has no DOM dependency.
 *
 * See issue #2969: jsdom cannot be loaded at module top level in Turbopack
 * server builds.
 */

import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'thead', 'tbody',
  'tr', 'th', 'td',
];
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel',
];

/**
 * Sanitize HTML string for safe rendering in dangerouslySetInnerHTML.
 * Client-only — imports DOMPurify (jsdom) which is unavailable on the server.
 */
export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ['target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as string;
}

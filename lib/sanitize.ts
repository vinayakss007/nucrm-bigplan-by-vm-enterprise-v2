/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Server-safe HTML sanitization.
 *
 * `sanitizeHTMLServer` strips all HTML tags without any DOM dependency, so it
 * is safe to import from server-only routes (cron, API routes) on any Node
 * runtime — including Next.js Turbopack server builds, where jsdom/DOMPurify
 * cannot be loaded at module top level.
 *
 * Client-side HTML sanitization (allow-listed tags) lives in
 * `lib/sanitize-dompurify.ts` so importing `isomorphic-dompurify`/jsdom never
 * crashes a server-side build.
 */

export function sanitizeHTMLServer(html: string): string {
  // Remove script/style blocks entirely (including content), then strip every
  // remaining HTML tag, keeping only text. No DOMPurify/jsdom needed because
  // nothing is permitted through. Matches DOMPurify with ALLOWED_TAGS: [].
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '');
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

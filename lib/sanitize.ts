/**
 * XSS Sanitation Utility
 * Wraps DOMPurify to sanitize HTML before rendering with dangerouslySetInnerHTML
 */

import createDOMPurify from 'dompurify';

let DOMPurify: ReturnType<typeof createDOMPurify> | null = null;

function getDOMPurify(windowRef: Window) {
  if (!DOMPurify) {
    DOMPurify = createDOMPurify(windowRef as any);
  }
  return DOMPurify;
}

/**
 * Sanitize HTML string for safe rendering in dangerouslySetInnerHTML
 * Use this in client components where `window` is available
 */
export function sanitizeHTML(html: string, windowRef?: Window): string {
  if (typeof window === 'undefined' && !windowRef) {
    // Server-side: strip all HTML tags as a safe fallback
    return html.replace(/<[^>]*>/g, '');
  }
  const purify = getDOMPurify(windowRef ?? window);
  return purify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel'],
    ADD_ATTR: ['target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

/**
 * Server-side safe sanitize — strips all tags when no DOM is available
 */
export function sanitizeHTMLServer(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

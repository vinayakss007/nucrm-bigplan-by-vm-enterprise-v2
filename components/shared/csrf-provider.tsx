'use client';
import { useEffect } from 'react';

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)nucrm_csrf_token=([^;]+)/);
  return match ? match[1] ?? null : null;
}

function shouldAttachCsrf(url: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export default function CsrfProvider() {
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function csrfFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');

      if (shouldAttachCsrf(url, method ?? 'GET')) {
        const token = getCsrfToken();
        if (token) {
          const existingHeaders = init?.headers;
          const headers = new Headers();
          if (existingHeaders instanceof Headers) {
            existingHeaders.forEach((v, k) => headers.set(k, v));
          } else if (Array.isArray(existingHeaders)) {
            existingHeaders.forEach(([k, v]) => headers.set(k, v));
          } else if (existingHeaders && typeof existingHeaders === 'object') {
            Object.entries(existingHeaders).forEach(([k, v]) => headers.set(k, v as string));
          }
          if (input instanceof Request) {
            input.headers.forEach((v, k) => {
              if (!headers.has(k)) headers.set(k, v);
            });
          }
          if (!headers.has('X-CSRF-Token')) {
            headers.set('X-CSRF-Token', token);
          }
          return originalFetch(input, { ...init, headers });
        }
      }
      return originalFetch(input, init);
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, []);

  return null;
}

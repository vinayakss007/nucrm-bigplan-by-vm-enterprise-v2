/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * PII redaction helpers for logs (Issue #1225).
 *
 * Logs are shipped to third parties (log files, Loki, Sentry breadcrumbs) and
 * must never carry raw emails or phone numbers. Use these at the log site:
 *
 *   redactEmail('jane.doe@acme.com') -> 'j***@acme.com'
 *   redactPhone('+1 (555) 123-4567') -> '***4567'
 */

/** Redacts an email to first character + *** + @domain. */
export function redactEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '***';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at >= email.length - 1) return '***';
  return `${email[0]!}***@${email.slice(at + 1)}`;
}

/** Redacts a phone number to *** + last 4 digits. */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return '***';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

/**
 * Redacts a URL for logging (Issue #1293). Webhook/callback URLs frequently
 * carry secrets in the query string (tokens, API keys, signatures) or in
 * userinfo (user:pass@host). Returns only `origin + pathname`, with a `?…`
 * marker when a query string was present, so logs remain useful for debugging
 * without leaking credentials.
 *
 *   redactUrl('https://x.com/hook?token=abc') -> 'https://x.com/hook?…'
 */
export function redactUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '***';
  try {
    const u = new URL(url);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?…` : base;
  } catch {
    // Not a parseable absolute URL — drop anything after the first '?' defensively.
    const q = url.indexOf('?');
    return q === -1 ? url : `${url.slice(0, q)}?…`;
  }
}

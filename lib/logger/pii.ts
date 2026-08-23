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

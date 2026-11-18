'use client';
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the selective-restore wizard used to feed every response body into
 * its next step without checking the status. A 500 from /preview or /scope
 * therefore became a valid-looking preview of a destructive restore. One
 * helper for the JSON steps makes a failed request a thrown error instead.
 *
 * Browser-only: its sole caller is the 'use client' selective-restore page and
 * every URL it receives is a same-origin relative API path. The directive also
 * keeps it out of the tenant-egress guard, which scans server-side fetches.
 */
export async function fetchRestoreJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const err = record.error;
  const message = typeof err === 'string' ? err
    : err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : `Request failed (${res.status})`;
  if (!res.ok || record.ok === false || record.success === false) throw new Error(message);
  return body as T;
}

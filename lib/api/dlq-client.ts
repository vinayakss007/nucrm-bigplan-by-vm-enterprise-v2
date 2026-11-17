/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the DLQ page used `.json().catch(() => ({}))` without checking
 * `res.ok`, so a 500 reached the mutation's onSuccess as
 * `{succeeded:0, failed:0}` and was reported as "No entry found". Throw on a
 * failed request instead, so the mutation takes its error path.
 */
export async function postDlqAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/tenant/webhooks/dlq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  const record = d && typeof d === 'object' ? d as Record<string, unknown> : {};
  const err = record.error;
  const message = typeof err === 'string' ? err
    : err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : `Request failed (${res.status})`;
  if (!res.ok || record.ok === false || record.success === false) throw new Error(message);
  return d as T;
}

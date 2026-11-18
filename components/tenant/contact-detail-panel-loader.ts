/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
/**
 * #3408 — the contact detail tabs used to turn a failed fetch into `[]`, so
 * "could not ask" rendered as "No edit history yet" / "No leads linked" /
 * "No calls logged yet". One loader for all three keeps the failure explicit
 * and lets the call-log refresh keep the rows it already had.
 */
import { clientLogError } from '@/lib/client-logger';

export type PanelListResult<T> = { rows: T[]; failed: boolean };

export async function loadPanelList<T>(
  url: string,
  context: string,
  signal?: AbortSignal,
): Promise<PanelListResult<T>> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    const body = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const err = b.error;
      if (b.ok === false || b.success === false || (typeof err === 'string' && err.length > 0)
        || (err && typeof err === 'object' && 'message' in err)) {
        throw new Error(`${url} returned a failure envelope`);
      }
    }
    const rows = (body as { data?: unknown })?.data;
    if (!Array.isArray(rows)) throw new Error(`${url} returned no data array`);
    return { rows: rows as T[], failed: false };
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === 'AbortError') return { rows: [], failed: false };
    clientLogError(context, err);
    return { rows: [], failed: true };
  }
}

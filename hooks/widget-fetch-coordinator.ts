'use client';
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1993: widget-fetch coordinator.
 *
 * Every dashboard widget used to fire its own fetch on mount, on its own
 * interval tick, and again on every visibilitychange — ~15 concurrent
 * requests that each pinned a pooled DB connection. This module collects
 * widget fetches issued within a small window and collapses the whitelisted
 * /api/tenant/dashboard/widgets/* ones into a single
 * GET /api/tenant/dashboard/batch?paths=... call (which runs the handlers
 * server-side with bounded concurrency). Duplicate in-flight requests for
 * the same endpoint are deduped, and if batching fails the items fall back
 * to individual fetches so a broken batch never blanks the dashboard.
 */

const BATCH_PREFIX = '/api/tenant/dashboard/widgets/';
const BATCH_ENDPOINT = '/api/tenant/dashboard/batch';
const BATCH_WINDOW_MS = 50;

export interface WidgetFetchResult {
  status: number;
  json: unknown;
}

interface Waiter {
  path: string;
  resolve: (r: WidgetFetchResult) => void;
  reject: (e: unknown) => void;
}

let pending: Waiter[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const inflight = new Map<string, Promise<WidgetFetchResult>>();

async function fetchDirect(item: Waiter): Promise<void> {
  try {
    const res = await fetch(item.path, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    item.resolve({ status: res.status, json: await res.json() });
  } catch (err) {
    item.reject(err);
  }
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;

  const batchable = batch.filter(b => b.path.startsWith(BATCH_PREFIX));
  for (const item of batch.filter(b => !b.path.startsWith(BATCH_PREFIX))) {
    void fetchDirect(item);
  }
  if (batchable.length === 0) return;

  const uniquePaths = [...new Set(batchable.map(b => b.path))];
  try {
    const res = await fetch(
      `${BATCH_ENDPOINT}?paths=${encodeURIComponent(uniquePaths.join(','))}`,
      { credentials: 'include' },
    );
    if (!res.ok) throw new Error(`batch HTTP ${res.status}`);
    const json = await res.json() as {
      data?: { results?: Record<string, { status: number; body: unknown }> };
    };
    const results = json?.data?.results ?? {};
    const unresolved: Waiter[] = [];
    for (const item of batchable) {
      const entry = results[item.path];
      if (entry && entry.status < 400) {
        item.resolve({ status: entry.status, json: entry.body });
      } else if (entry) {
        item.reject(new Error(`HTTP ${entry.status}: widget error`));
      } else {
        unresolved.push(item);
      }
    }
    for (const item of unresolved) void fetchDirect(item);
  } catch {
    for (const item of batchable) void fetchDirect(item);
  }
}

/**
 * Fetch a dashboard/widget endpoint, coalescing with any other fetches
 * scheduled within the same small window.
 */
export function fetchWidgetData(path: string): Promise<WidgetFetchResult> {
  const existing = inflight.get(path);
  if (existing) return existing;
  const promise = new Promise<WidgetFetchResult>((resolve, reject) => {
    pending.push({ path, resolve, reject });
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), BATCH_WINDOW_MS);
  });
  inflight.set(path, promise);
  const clear = () => { inflight.delete(path); };
  promise.then(clear, clear);
  return promise;
}

/**
 * Shared visibilitychange subscribers — one document listener for the whole
 * page instead of one per widget (refetch-storm fix in #1993).
 */
const visibleCallbacks = new Set<() => void>();
let visibilityBound = false;

export function onTabVisible(callback: () => void): () => void {
  visibleCallbacks.add(callback);
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        for (const cb of [...visibleCallbacks]) cb();
      }
    });
  }
  return () => { visibleCallbacks.delete(callback); };
}

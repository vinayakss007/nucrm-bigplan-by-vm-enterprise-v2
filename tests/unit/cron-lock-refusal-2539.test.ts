/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2539 — a cron job whose lock is refused must not report success.
 *
 * The register entry (PP-049) counted 22 routes that each answered
 * `200 { ok: true, skipped: true }` when `acquireLock` refused, because the
 * block was copy-pasted per route rather than centralised. Fixing 22 copies is
 * only worth it if the copies cannot come back, so this file walks the real
 * route modules — every directory under `app/api/cron/`, read from the
 * filesystem, so a 23rd route is covered the day it is added — and calls its
 * actual POST handler with the lock held.
 *
 * Nothing here reaches a database: the refusal is returned before the job body
 * runs, and `withApiRoute` is stubbed to the identity so the pinned-connection
 * checkout never happens. The auth check is left REAL (only `logError` is
 * stubbed), which is also what pins the order: a bad secret must still answer
 * 401, and only an authenticated caller may be told the job is busy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const CRON_SECRET = 'unit-test-cron-secret-for-2539';
process.env.CRON_SECRET = CRON_SECRET;

/** The whole point: `acquired: false` is what every route sees under test. */
let lockOutcome = { acquired: false, value: '' };
const mockAcquireLock = vi.fn(async (_key: string, _ttl: number) => lockOutcome);

// A named import that the factory does not provide would be undefined at call
// time, and these routes pull in a wide graph (email, pdf, queue, backups).
// The lock trio is under test; the rest only has to load.
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
  releaseLock: async () => {},
  refreshLock: async () => {},
  set: async () => {},
  get: async () => null,
  getOrSet: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  getOrSetStale: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  warm: async () => {},
  del: async () => {},
  delByPattern: async () => {},
  exists: async () => 0,
  incr: async () => 0,
  cachedQuery: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  health: async () => ({ status: 'disabled' }),
  _resetCircuitBreaker: () => {},
  _getCircuitState: () => ({ state: 'closed', failures: 0 }),
}));

// withPinnedConnection() checks a real pool client out before the handler runs;
// this test never gets that far, and must not need a database to prove it.
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(fn: T) => fn }));

// My refusal helper logs the skip through this module (fire-and-forget, guarded
// in production). Stubbed so a unit run cannot try to write an error_logs row.
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

const cronDirs = readdirSync(join(process.cwd(), 'app/api/cron'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function cronRequest(dir: string): never {
  return {
    method: 'POST',
    url: `http://localhost/api/cron/${dir}`,
    headers: new Headers({ 'x-cron-secret': CRON_SECRET }),
  } as never;
}

async function callPOST(dir: string) {
  // The `.ts` is part of the static string on purpose: Vite's dynamic-import-vars
  // plugin cannot build the glob otherwise and warns on every run.
  const mod = (await import(`@/app/api/cron/${dir}/route.ts`)) as {
    POST: (req: never) => Promise<Response>;
  };
  const res = await mod.POST(cronRequest(dir));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('cron dedup lock refusal (#2539)', () => {
  beforeEach(() => {
    mockAcquireLock.mockClear();
    lockOutcome = { acquired: false, value: '' };
  });

  it('enumerates every cron route, so the suite cannot silently shrink', () => {
    // 22 is the measured count at main = 2d037d6a (#2539). If a route is added
    // and this moves, the new route is picked up by the it.each below — which is
    // the point of reading the directory instead of pasting a list.
    expect(cronDirs).toHaveLength(22);
    expect(cronDirs).toContain('recurring-invoice-generator');
  });

  it.each(cronDirs)('POST /api/cron/%s answers 423 and ok:false when the lock is held', async (dir) => {
    const { status, body } = await callPOST(dir);

    expect(status).toBe(423);
    // ok:true is the bug: it is what made "ran" and "did nothing" identical.
    expect(body.ok).toBe(false);
    expect(body.skipped).toBe('lock-held');
    expect(body.reason).toBe('lock-held');
    // app/api/tenant/backup surfaces body.error to whoever pressed "Back up
    // now" while the nightly job held the lock — it must say why, not "null".
    expect(typeof body.error).toBe('string');
    expect(String(body.error)).toContain(dir);
  });

  it.each(cronDirs)('POST /api/cron/%s locks its own key with a positive TTL', async (dir) => {
    await callPOST(dir);

    expect(mockAcquireLock).toHaveBeenCalledTimes(1);
    const [key, ttl] = mockAcquireLock.mock.calls[0];
    // The key convention is `cron:<route>`; a route locking someone else's key
    // would dedup against the wrong job and skip runs that should not skip.
    expect(key).toBe(`cron:${dir}`);
    expect(typeof ttl).toBe('number');
    expect(ttl).toBeGreaterThan(0);
  });

  it('answers 401 before it ever reports a busy lock', async () => {
    // Order matters: a caller without the secret must not be able to use the
    // routes as a lock-state oracle (423 vs 401 tells them a job is running).
    const mod = (await import('@/app/api/cron/trial-check/route')) as {
      POST: (req: never) => Promise<Response>;
    };
    const res = await mod.POST({
      method: 'POST',
      url: 'http://localhost/api/cron/trial-check',
      headers: new Headers({ 'x-cron-secret': 'wrong-secret' }),
    } as never);

    expect(res.status).toBe(401);
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });
});

describe('lib/cron/cron-lock (#2539)', () => {
  it('returns null — run the job — when the lock is ours', async () => {
    lockOutcome = { acquired: true, value: '1:1' };
    const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

    expect(await refuseIfCronLockHeld('cron:trial-check', 3600)).toBeNull();
    expect(mockAcquireLock).toHaveBeenCalledWith('cron:trial-check', 3600);
  });

  it('builds the refusal once, so status and body cannot drift apart', async () => {
    const { cronLockRefusalResponse, CRON_LOCK_REFUSED_STATUS, CRON_LOCK_REFUSED_REASON } =
      await import('@/lib/cron/cron-lock');

    const res = cronLockRefusalResponse('cron:cleanup');
    expect(res.status).toBe(CRON_LOCK_REFUSED_STATUS);
    expect(CRON_LOCK_REFUSED_STATUS).toBe(423);
    expect(await res.json()).toEqual({
      ok: false,
      skipped: CRON_LOCK_REFUSED_REASON,
      reason: CRON_LOCK_REFUSED_REASON,
      error: 'Cron job "cron:cleanup" did not run: its lock is already held by another instance',
    });
  });
});

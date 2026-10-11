/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cron dedup lock — one refusal response, shared by every cron route (#2539).
 *
 * All 22 routes under `app/api/cron/` used to answer a refused concurrency lock
 * with `200 { ok: true, skipped: true }`. So "the nightly job ran" and "the
 * nightly job did nothing" were the same status code to the scheduler, the same
 * green line in the panel, and — because the reason string was copy-pasted per
 * route — two different literals (`'lock-held'` in 20 files, `'Another instance
 * running'` in 2) for the same event. A skip is not a success; it is the job
 * not running. It now answers `423 Locked` with `ok: false`.
 *
 * What that makes visible, measured at `main = 2d037d6a`:
 *   - `scripts/cron-scheduler.ts:71-75` logs `res.ok` as `✓` and anything else
 *     as `✗ <job> — HTTP <status>: <first 200 chars of body>`, with no retry.
 *   - `deploy/cron/run-cron.sh` runs `wget -q -O /dev/null ... || echo CRON
 *     FAILED` — a 4xx/5xx makes wget exit non-zero, so a skipped run now prints
 *     its own line instead of vanishing.
 *   - `app/api/tenant/backup/route.ts:92-115` reads the body's `error` field,
 *     which is why this response carries one — and forwards 423 as 423, so an
 *     operator pressing "Back up now" during the nightly run sees the reason.
 *
 * Why a guard call and not the callback form (`withCronLock(key, () => body)`):
 * every route body would move one indent level, turning a behaviour fix into a
 * 22-file reformat that collides with the cron work already in flight
 * (sequence lifecycle, auto-backup tombstones, per-tenant sweeps). The refusal
 * decision and its response are the parts that were duplicated; the body was
 * never the problem.
 *
 * Why this is not named `withCronLock`: that name already belongs to
 * `lib/cron/distributed-lock.ts`, a PostgreSQL *advisory*-lock wrapper that no
 * cron route uses (only its `jobNameToLockId` is imported, by
 * `lib/tenant-restore-lock.ts`). Two lock mechanisms answering a skipped job
 * with two different verbs, in the same directory, under one name, is exactly
 * how the next copy-paste picks the wrong one.
 *
 * Redis unavailability: `lib/cache#acquireLock` fails CLOSED (see the #M3 note
 * there), so when Redis is down this returns a refusal and the job does not
 * run. That is the pre-existing behaviour — what changes is that the caller can
 * now tell.
 */
import { NextResponse } from 'next/server';
import { acquireLock } from '@/lib/cache';

/** Machine-readable reason carried by every refused cron lock (#2539). */
export const CRON_LOCK_REFUSED_REASON = 'lock-held';

/**
 * The one place that knows a skipped cron run is a failure. 423 is "Locked"
 * (RFC 4918 §11): the request is valid but the resource is locked — distinct
 * from 401 (bad secret), 429 (rate limited) and 500 (the job threw).
 */
export const CRON_LOCK_REFUSED_STATUS = 423;

/**
 * Build the refusal. `ok: false` so no consumer can mistake it for a run,
 * `skipped`/`reason` so a log line names the cause, and `error` because
 * `app/api/tenant/backup` surfaces that field to the operator who pressed
 * "Back up now" while the nightly job holds the lock.
 */
export function cronLockRefusalResponse(key: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      skipped: CRON_LOCK_REFUSED_REASON,
      reason: CRON_LOCK_REFUSED_REASON,
      error: `Cron job "${key}" did not run: its lock is already held by another instance`,
    },
    { status: CRON_LOCK_REFUSED_STATUS },
  );
}

/**
 * Take the route's dedup lock. Returns the 423 refusal the caller should hand
 * straight back, or `null` when the lock is ours and the job body may run.
 *
 * The lock is deliberately NOT released here: `ttlSeconds` is also the minimum
 * spacing between two accepted runs (that is what 20 of the 22 routes already
 * relied on, and what keeps a scheduler that double-fires from double-sending
 * email). Jobs that must be able to re-run the moment their body finishes hold
 * the value and call `releaseLock` themselves — see `cron:process-sequences` and
 * `cron:scheduled-report-delivery`.
 */
export async function refuseIfCronLockHeld(
  key: string,
  ttlSeconds: number,
): Promise<NextResponse | null> {
  const lock = await acquireLock(key, ttlSeconds);
  if (lock.acquired) return null;
  recordCronSkip(key);
  return cronLockRefusalResponse(key);
}

/**
 * Put the skip in the log the operator reads, not just in the HTTP response
 * that the scheduler may never print. Mirrors `lib/auth/cron.ts#auditCronAuth`:
 * fire-and-forget, dynamically imported and fully guarded, so a missing DB (or
 * a unit test with no DB at all) can never turn a 423 into a 500.
 */
function recordCronSkip(key: string): void {
  void (async () => {
    try {
      const { logError } = await import('@/lib/errors-server');
      await logError({
        error: new Error(`Cron lock refused for "${key}" — run skipped, not executed`),
        context: 'cron-lock',
        level: 'warning',
        metadata: { job: key, reason: CRON_LOCK_REFUSED_REASON },
      });
    } catch {
      /* logging must never change what the job answers */
    }
  })();
}

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
 *
 * #3259, because the refusals below are NOT all the same event: a client that
 * has not finished its Redis handshake also answered `acquired: false`, and the
 * first cron request of a process start always saw one — `getRedisClient()`
 * builds the client lazily on that very call, so its status was still
 * `'connecting'`. Deterministic, not a race: every restart skipped its first run
 * and both `recordCronSkip` and the 423 blamed another instance, while the retry
 * that "proved it working" was just the second call finding the ready state.
 * `lib/cache/redis-ready.ts` gives that one case a bounded grace window before
 * the fail-closed answer. What remains are the two real states, named apart
 * since ask 2 of the same issue: `lock-held` when a peer owns the key,
 * `lock-unavailable` when the store could not be consulted.
 */
import { NextResponse } from 'next/server';
import { acquireLock } from '@/lib/cache';
import { registerCronRun } from './health';

/** Machine-readable reason carried by every refused cron lock (#2539). */
export const CRON_LOCK_REFUSED_REASON = 'lock-held';

/**
 * #3259 ask 2 — the other half of a refusal, which used to answer with
 * `'lock-held'` too: a Redis outage read as a busy scheduler, blaming a peer
 * that does not exist. Status stays 423; only the reason changes.
 */
export const CRON_LOCK_UNAVAILABLE_REASON = 'lock-unavailable';

export type CronLockRefusalReason =
  | typeof CRON_LOCK_REFUSED_REASON
  | typeof CRON_LOCK_UNAVAILABLE_REASON;

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
export function cronLockRefusalResponse(
  key: string,
  reason: CronLockRefusalReason = CRON_LOCK_REFUSED_REASON,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      skipped: reason,
      reason,
      error: refusalMessage(key, reason),
    },
    { status: CRON_LOCK_REFUSED_STATUS },
  );
}

function refusalMessage(key: string, reason: CronLockRefusalReason): string {
  return reason === CRON_LOCK_UNAVAILABLE_REASON
    ? `Cron job "${key}" did not run: its lock store could not be consulted, so the dedup check failed closed — no other instance is implied`
    : `Cron job "${key}" did not run: its lock is already held by another instance`;
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
  const reason: CronLockRefusalReason =
    lock.reason === 'unavailable' ? CRON_LOCK_UNAVAILABLE_REASON : CRON_LOCK_REFUSED_REASON;
  recordCronSkip(key, reason);
  return cronLockRefusalResponse(key, reason);
}

/**
 * Put the skip in the log the operator reads, not just in the HTTP response
 * that the scheduler may never print. Mirrors `lib/auth/cron.ts#auditCronAuth`:
 * fire-and-forget, dynamically imported and fully guarded, so a missing DB (or
 * a unit test with no DB at all) can never turn a 423 into a 500.
 */
function recordCronSkip(key: string, reason: CronLockRefusalReason): void {
  void (async () => {
    try {
      const { logError } = await import('@/lib/errors-server');
      await logError({
        error: new Error(
          reason === CRON_LOCK_UNAVAILABLE_REASON
            ? `Cron lock store unreachable for "${key}" — run refused fail-closed, no peer involved`
            : `Cron lock refused for "${key}" — run skipped, not executed`,
        ),
        context: 'cron-lock',
        // An unreachable store is an outage; contention is routine.
        level: reason === CRON_LOCK_UNAVAILABLE_REASON ? 'error' : 'warning',
        metadata: { job: key, reason },
      });
    } catch {
      /* logging must never change what the job answers */
    }
  })();
}

// ── run ledger (#3410) ───────────────────────────────────────────────────────

/**
 * Wrap a cron route so every attempt lands in `cron_runs` — success, failure
 * and skipped-by-lock alike. This is the writer the in-memory registry never
 * had and the row that makes `/api/system/cron-health` able to say `never_run`
 * instead of remembering only what this process saw since boot.
 *
 * Why a response-level wrapper and not a callback lock: the refusal half of
 * `refuseIfCronLockHeld` already lives in one place; what was missing was the
 * OTHER exit of every route — the body's response, the throw, and the 423
 * walking back out. Wrapping the exported POST sees all three without moving
 * a single line of job logic, and the manifest guard (`guard:cron-manifest`)
 * fails any cron route whose POST does not go through here, which is what
 * "no job can opt out" means in practice.
 *
 * Recording is fire-and-forget and total-failure-proof like `recordCronSkip`:
 * a missing DB turns into no row and a quiet console line, never a 500 on a
 * job that actually ran.
 */
export function instrumentCronRun<R extends Request>(
  jobName: string,
  handler: (request: R) => Promise<Response>,
): (request: R) => Promise<Response> {
  return async (request: R): Promise<Response> => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await handler(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      persistCronRun(jobName, startedAt, false, `threw: ${message.slice(0, 200)}`);
      throw err;
    }
    const status = response.status;
    const ok = status >= 200 && status < 400;
    if (!ok) {
      const detail = await describeFailure(response, status);
      persistCronRun(jobName, startedAt, false, detail);
    } else {
      persistCronRun(jobName, startedAt, true, null);
    }
    return response;
  };
}

async function describeFailure(response: Response, status: number): Promise<string> {
  let body = '';
  try {
    // clone() first: the caller still owns the original stream.
    body = (await response.clone().text()).slice(0, 200);
  } catch {
    /* an unreadable body only costs the ledger its detail column */
  }
  if (status === CRON_LOCK_REFUSED_STATUS) {
    try {
      const parsed = JSON.parse(body) as { skipped?: string };
      if (typeof parsed.skipped === 'string') return `skipped: ${parsed.skipped}`;
    } catch {
      /* fall through to the generic shape below */
    }
    return 'skipped: lock-held';
  }
  return `HTTP ${status}${body ? `: ${body}` : ''}`;
}

function persistCronRun(jobName: string, startedAt: number, ok: boolean, error: string | null): void {
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  // The in-memory registry keeps its record too: same process, same truth,
  // and tests/dashboard readers of lib/cron/health stay meaningful.
  try {
    registerCronRun(jobName, { durationMs, status: ok ? 'ok' : 'error', error: error ?? undefined });
  } catch {
    /* registry is bounded and dumb; it cannot fail this way */
  }
  void (async () => {
    try {
      const [{ db }, { cronRuns }] = await Promise.all([
        import('@/drizzle/db'),
        import('@/drizzle/schema'),
      ]);
      await db.insert(cronRuns).values({
        job: jobName,
        startedAt: new Date(startedAt),
        finishedAt: new Date(finishedAt),
        ok,
        error,
        durationMs,
      });
    } catch {
      /* the ledger write must never change what the job answered */
    }
  })();
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Compliance request lifecycle — #2530 (part 2).
 *
 * WHY THIS EXISTS
 * ---------------
 * `POST /api/tenant/compliance/gdpr` and `POST /api/tenant/compliance/soc2`
 * write a `processing` row, do the work, then write a terminal marker. Every
 * path that dies between those two writes leaves the row saying `processing`
 * FOREVER: SIGTERM after the drain deadline, an OOM kill, a redeploy, or the
 * terminal `UPDATE` itself throwing — which is the path that matters most,
 * because in both routes the marker write sits inside the `try` whose `catch`
 * writes the *other* marker, so if that write also throws, nothing is left.
 *
 * For a `soc2_report` a stuck row is a console that lies. For a `gdpr_delete` it
 * is worse: Article 17 erasure requests are judged by the log, and a log that
 * never resolves cannot be told apart from an erasure that never ran.
 *
 * THE RULE
 * --------
 * A `processing` row whose `created_at` is more than PROCESSING_DEADLINE_MS old
 * is REPORTED as failed, with the reason naming the deadline, and is best-effort
 * persisted so the stored record stops lying too. `completed_at` is never
 * filled in — an unresolved request did not complete, and minting a completion
 * timestamp would be the more damaging fiction.
 *
 * WHY NOT THE PART-1 FIX (ONE TRANSACTION)?
 * -----------------------------------------
 * Wrapping the erasure and its lifecycle row in a single transaction would delete
 * the evidence: rolling back on failure also removes the row that says an erasure
 * was ATTEMPTED. A compliance log has to outlive the operation it describes, so
 * these two writes are deliberately NOT atomic, and the deadline is what makes
 * the non-atomicity recoverable instead of permanent.
 *
 * WHY REAP ON READ, NOT IN A CRON?
 * -------------------------------
 * A read is the only moment this status is consumed — the console is the sole
 * audience for the word `processing` — so reaping there is both guaranteed to
 * run and impossible to mis-schedule. The cron path is the weaker house: five
 * cron routes are not on the live schedule at all (PP-051) and the scheduled
 * ones needed PP-049 to teach them to report a refused lock instead of
 * answering `ok:true`. The write is idempotent and CAS-guarded — its `WHERE`
 * requires `status = 'processing'` — so a request that is merely slow can still
 * flip its own row to `completed` afterwards, and the reaper can never overwrite
 * a marker that landed first.
 */
import { db, type DbClient } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';
import { logError } from '@/lib/errors-server';
import { and, eq } from 'drizzle-orm';

/**
 * How long a `processing` row may stand before it is treated as abandoned.
 *
 * Sized from the work, not picked: the export issues 8 SELECTs in parallel and
 * the anonymise path issues 5 sequential UPDATEs (`lib/compliance/gdpr.ts`), and
 * PP-028 measured every statement in preprod at a flat ~200 ms, so a full
 * request is seconds, not minutes. The deadline is 15 minutes so that a large
 * tenant on a loaded pool — not a dead process — is the only thing that could
 * ever cross it, and even then the row's own request can still complete.
 */
export const PROCESSING_DEADLINE_MS = 15 * 60 * 1000;

/**
 * What a reaped row says. It names the mechanism because the honest answer to
 * "was this erasure performed?" is "unknown" — the request died without writing
 * a terminal marker, so the outcome is not knowable from here.
 */
export const STALE_PROCESSING_MESSAGE =
  'abandoned: no terminal marker within 15 min — outcome unknown (the request died, or its own completion write failed)';

/** The columns the rule reads. Deliberately loose: rows arrive from `db.select()`. */
export interface LifecycleRow {
  id: string;
  status: string | null;
  createdAt: Date | string | null;
}

/** A row the reaper annotated: `stale` is the truth the stored status cannot tell. */
export type ReapedRow<T> = T & { stale?: boolean; staleReason?: string };

export interface ReaperResult<T> {
  rows: ReapedRow<T>[];
  /** ids this call actually moved from `processing` to `failed` */
  reaped: string[];
  /** rows reported stale whose write did not land — the read still told the truth */
  persistenceFailures: number;
}

function ageMs(row: LifecycleRow, nowMs: number): number {
  const created =
    row.createdAt instanceof Date ? row.createdAt.getTime() : Date.parse(String(row.createdAt ?? ''));
  // An unparseable `created_at` is treated as expired rather than immortal: the
  // whole point of the rule is that a row can never claim `processing` forever.
  return Number.isFinite(created) ? nowMs - created : Number.POSITIVE_INFINITY;
}

/**
 * Strictly greater-than: a row exactly at the deadline is still in flight. The
 * boundary is asserted in `tests/unit/compliance-processing-reaper-2530.test.ts`
 * because `>=` here would fail a request that takes the deadline to the
 * millisecond, and `<` would never fail one at all.
 */
export function isStaleProcessing(
  row: LifecycleRow,
  nowMs: number = Date.now(),
  deadlineMs: number = PROCESSING_DEADLINE_MS,
): boolean {
  return row.status === 'processing' && ageMs(row, nowMs) > deadlineMs;
}

/**
 * Report — and best-effort persist — every `processing` row past the deadline.
 *
 * `tenantId` is part of the `UPDATE`'s `WHERE` rather than only the caller's
 * `SELECT`, so a row that belongs to another tenant cannot be moved by this
 * write even if a future caller hands it a list it should not have had. RLS
 * already scopes the statement; this is the app-level filter the repo pairs with
 * it everywhere else.
 */
export async function reapStaleProcessing<T extends LifecycleRow>(opts: {
  rows: T[];
  tenantId: string;
  nowMs?: number;
  dbOrTx?: DbClient;
}): Promise<ReaperResult<T>> {
  const { rows, tenantId, nowMs = Date.now() } = opts;
  const client = opts.dbOrTx ?? db;
  const out: ReapedRow<T>[] = [];
  const reaped: string[] = [];
  let persistenceFailures = 0;

  for (const row of rows) {
    if (!isStaleProcessing(row, nowMs)) {
      out.push(row);
      continue;
    }

    out.push({ ...row, status: 'failed', stale: true, staleReason: STALE_PROCESSING_MESSAGE });

    try {
      await client
        .update(complianceRequests)
        .set({
          status: 'failed',
          errorMessage: STALE_PROCESSING_MESSAGE,
          updatedAt: new Date(nowMs),
        })
        .where(
          and(
            eq(complianceRequests.id, row.id),
            eq(complianceRequests.tenantId, tenantId),
            // CAS: never overwrite a terminal marker that landed while we were reading.
            eq(complianceRequests.status, 'processing'),
          ),
        );
      reaped.push(row.id);
    } catch {
      // The record is repaired when it can be; the answer to this caller does not
      // depend on that write succeeding, so a failing UPDATE cannot turn the
      // console into a 500 — and cannot hide the row's true state either.
      persistenceFailures += 1;
    }
  }

  return { rows: out, reaped, persistenceFailures };
}

/**
 * Write the `completed` marker for a request whose work succeeded, and report
 * whether the record accepted it.
 *
 * The routes used to issue this statement INSIDE the `try` whose `catch` writes
 * `failed`, so a request whose erasure ran but whose marker threw was recorded as
 * `failed` — a compliance log claiming an Article 17 erasure had not happened,
 * when it had. That inversion is the reason this helper swallows its own failure:
 * the caller already knows the outcome, and a record that cannot be updated must
 * not become a different outcome.
 *
 * Deliberately NOT CAS-guarded, unlike the reaper's write: a request that
 * outlived the deadline and was reaped must still be able to record its real
 * result, so `completed` is allowed to overwrite the reaper's `failed`.
 *
 * `tenantId` is part of the `WHERE` for the same reason it is in the reaper's:
 * RLS would refuse the statement anyway, but a refused write says nothing, and
 * an app-level filter is what this repo pairs with RLS everywhere else (#2525).
 */
export async function markRequestCompleted(
  requestId: string,
  tenantId: string,
  result: Record<string, unknown>,
  dbOrTx?: DbClient,
): Promise<boolean> {
  const client = dbOrTx ?? db;
  try {
    await client
      .update(complianceRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
        result,
        updatedAt: new Date(),
      })
      .where(and(eq(complianceRequests.id, requestId), eq(complianceRequests.tenantId, tenantId)));
    return true;
  } catch (err) {
    void logError({ error: err, context: 'compliance request: completed marker' });
    return false;
  }
}

/**
 * Write the `failed` marker for a request whose work threw, and report whether the
 * record accepted it.
 *
 * The second half of the same inversion: if this write also throws it must not
 * escape to the route's outer `apiError` handler, because the caller is already
 * being told the work failed and the row is left `processing` for the reaper to
 * resolve. Losing the marker is a documentation gap; losing the response would
 * make a failed export look like an infrastructure fault.
 */
export async function markRequestFailed(
  requestId: string,
  tenantId: string,
  errorMessage: string,
  dbOrTx?: DbClient,
): Promise<boolean> {
  const client = dbOrTx ?? db;
  try {
    await client
      .update(complianceRequests)
      .set({ status: 'failed', errorMessage, updatedAt: new Date() })
      .where(and(eq(complianceRequests.id, requestId), eq(complianceRequests.tenantId, tenantId)));
    return true;
  } catch (err) {
    void logError({ error: err, context: 'compliance request: failed marker' });
    return false;
  }
}

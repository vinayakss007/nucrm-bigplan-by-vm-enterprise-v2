/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { verifyCronSecret } from '@/lib/auth/cron';
import { instrumentCronRun, refuseIfCronLockHeld } from '@/lib/cron/cron-lock';
import { withSecurityContext } from '@/lib/db/rls';

/**
 * POST /api/cron/reconcile-counters — daily (see lib/cron/jobs.ts).
 *
 * `tenants.current_contacts` is a hand-maintained copy of
 * `COUNT(contacts WHERE deleted_at IS NULL)`. #3452 made every insert door pay
 * for the row it inserts, in the same transaction, but the column is still a
 * copy: a missed path, a restore, a manual SQL fix or a failed partial write
 * leaves the plan gate priced against a number that is no longer true. This job
 * is the backstop the #3409 plan asked for — it recomputes the count from the
 * rows themselves and corrects the copy, so drift lasts at most one day.
 *
 * WHY THE PLATFORM CONTEXT
 * ------------------------
 * `contacts` and `tenants` are FORCE-RLS. Counting them tenant-by-tenant would
 * be correct but would also make the job's result depend on every tenant's
 * policy arm; the platform context (`app.is_super_admin`) is the one that sees
 * every live contact at once. It is a single `withSecurityContext` transaction,
 * so the privilege is `SET LOCAL` and cannot leak to another checkout.
 *
 * The update is one statement, not a loop: the `live` CTE derives the truth,
 * `drift` names only the rows that disagree, and `fixed` corrects exactly those
 * rows and returns the old/new pair. A tenant with no live contacts is still
 * reconciled to 0 (the LEFT JOIN), which is the case a plain GROUP BY misses.
 *
 * The drift row is logged at `warn`, not `error`: the job self-heals, so this
 * is a signal that a writer is wrong, not an outage. The response carries the
 * same evidence for the cron ledger and the health panel.
 */
type DriftRow = {
  tenant_id?: string | null;
  stored?: number | string | null;
  actual?: number | string | null;
};

function asRows(result: unknown): DriftRow[] {
  // db.execute() returns { rows } for raw SQL; the mocked client in unit tests
  // returns the array directly.
  if (Array.isArray(result)) return result as DriftRow[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as DriftRow[]) : [];
}

async function cronRouteHandler(request: NextRequest) {
  if (!await verifyCronSecret(request, { job: 'reconcile-counters' })) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1255/#1422): one reconciliation per interval.
  const refusal = await refuseIfCronLockHeld('cron:reconcile-counters', 3600);
  if (refusal) return refusal;

  try {
    const result = await withSecurityContext((tx) => tx.execute(sql`
      WITH live AS (
        SELECT tenant_id, COUNT(*)::int AS actual
          FROM contacts
         WHERE deleted_at IS NULL
         GROUP BY tenant_id
      ),
      drift AS (
        SELECT t.id AS tenant_id,
               COALESCE(t.current_contacts, 0) AS stored,
               COALESCE(l.actual, 0) AS actual
          FROM tenants t
          LEFT JOIN live l ON l.tenant_id = t.id
         WHERE COALESCE(t.current_contacts, 0) <> COALESCE(l.actual, 0)
      ),
      fixed AS (
        UPDATE tenants t
           SET current_contacts = d.actual
          FROM drift d
         WHERE t.id = d.tenant_id
        RETURNING t.id AS tenant_id, d.stored, d.actual
      )
      SELECT tenant_id, stored, actual FROM fixed
    `));

    const drift = asRows(result).map((row) => ({
      tenant_id: row.tenant_id ?? null,
      stored: Number(row.stored ?? 0),
      actual: Number(row.actual ?? 0),
    }));

    if (drift.length > 0) {
      // The evidence is bounded in the log line; the response carries the same
      // first 50 rows, so a large drift event can be investigated without
      // dumping a tenant list into the error pipeline.
      await logError({
        error: new Error(`tenants.currentContacts drifted for ${drift.length} tenant(s)`),
        context: 'cron/reconcile-counters',
        level: 'warning',
        captureToSentry: false,
        metadata: { drifted: drift.length, tenants: drift.slice(0, 20) },
      });
    }

    return NextResponse.json({
      ok: true,
      drifted: drift.length,
      corrected: drift.length,
      drift: drift.slice(0, 50),
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/reconcile-counters' });
    return apiError(err);
  }
}

// #3410: every attempt — run, failure, or lock-refusal — lands in cron_runs.
export const POST = instrumentCronRun('reconcile-counters', cronRouteHandler);

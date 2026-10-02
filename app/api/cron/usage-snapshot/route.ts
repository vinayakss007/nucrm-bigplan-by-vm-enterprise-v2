/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { withSecurityContext } from '@/lib/db/rls';
import { sweepTenants } from '@/lib/cron/tenant-scope';

/**
 * POST /api/cron/usage-snapshot — weekly (see scripts/cron-scheduler.ts).
 *
 * Calls the plpgsql function public.snapshot_tenant_usage(), which writes one
 * row per live tenant into usage_snapshots for CURRENT_DATE (SECURITY INVOKER,
 * migration 0081 — so every statement inside it runs under the CALLER's RLS
 * context).
 *
 * WHY THE PLATFORM CONTEXT IS REQUIRED
 * -----------------------------------
 * usage_snapshots' tenant_isolation policy (migration 0091) is
 *   USING / WITH CHECK
 *     tenant_id = NULLIF(current_setting('app.current_tenant'),'')::uuid
 *     OR NULLIF(current_setting('app.is_super_admin'),'')::boolean = true
 *
 * The function INSERTs for EVERY tenant in one statement. In a single tenant's
 * context the other tenants' rows fail WITH CHECK and Postgres aborts the whole
 * INSERT with a row-level-security violation — so this job cannot be converted
 * to sweepTenants (the all-tenant INSERT has no per-tenant form). The only
 * context that satisfies WITH CHECK for every row at once is app.is_super_admin,
 * which 0091 added for exactly this job. Run unscoped it satisfied neither
 * branch, threw on every run, and usage_snapshots stayed empty (0 rows in
 * pre-prod) while the route reported a 500 to the scheduler.
 *
 * withSecurityContext() is a single transaction with SET LOCAL, so the privilege
 * is dropped at COMMIT and cannot leak to another request's checkout.
 *
 * THE THREE PER-USER COLUMNS ARE FILLED IN SEPARATELY
 * --------------------------------------------------
 * The function's SELECTs read five tables. Under the platform context:
 *   contacts, leads, deals   — DO have the is_super_admin branch, so their
 *                               COUNTs are real.
 *   tenant_members           — plain tenant_isolation only → invisible →
 *                               users_count would be written as 0.
 *   user_usage               — plain tenant_isolation only → invisible →
 *                               storage_used_mb and api_calls_count would be 0.
 * Rather than widen those two policies (a schema decision, not made here), the
 * route re-runs those three aggregates per tenant under THAT tenant's own
 * context — which does admit both tables — and writes them back over today's
 * rows in one platform transaction, since 0091's UPDATE does admit any
 * tenant_id when app.is_super_admin is set. Same predicates as the function,
 * byte for byte; the INSERT stays a single all-tenant statement.
 *
 * The sweep only visits non-suspended tenants, so a suspended tenant keeps the
 * function's zeros. Its contacts/leads/deals counts are still written.
 * Until 0091's branch is extended, do not read a suspended tenant's
 * users_count/storage_used_mb/api_calls_count as a real measurement.
 */
export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Distributed dedup guard (#1255): skip if another scheduler already ran it.
  const lock = await acquireLock('cron:usage-snapshot', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    // The function call MUST go through the same transaction that carries
    // app.is_super_admin — a bare `db.execute` would check out a different
    // connection, lose the SET LOCAL, and hit the WITH CHECK violation again.
    const snapshots = await withSecurityContext(async (tx) => {
      const result = await tx.execute(sql`SELECT public.snapshot_tenant_usage() as count`);
      return (result.rows[0] as { count?: number } | undefined)?.count ?? 0;
    });

    const { corrected, sweep } = await backfillPerUserColumns();

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      snapshots,
      rows_corrected: corrected,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/usage-snapshot' });
    return apiError(err);
  }
}

/**
 * Re-measure users_count / storage_used_mb / api_calls_count per tenant and
 * write them over the rows snapshot_tenant_usage() just created.
 *
 * The read happens in each tenant's own RLS context (tenant_members and
 * user_usage have no super-admin branch); the write happens once, in the
 * platform context, because usage_snapshots' policy admits any tenant_id there.
 */
async function backfillPerUserColumns(): Promise<{
  corrected: number;
  sweep: Awaited<ReturnType<typeof sweepTenants>>;
}> {
  const measured: { tenantId: string; usersCount: number; storageMb: string; apiCalls: number }[] = [];

  const sweep = await sweepTenants('cron/usage-snapshot', async (tenantId) => {
    // Same predicates the plpgsql function uses, so the two sets of columns
    // describe one consistent moment.
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM tenant_members tm
           WHERE tm.tenant_id = ${tenantId}::uuid AND tm.status = 'active') AS users_count,
        COALESCE((SELECT sum(uu.storage_bytes)::numeric / (1024 * 1024) FROM user_usage uu
           WHERE uu.tenant_id = ${tenantId}::uuid AND uu.deleted_at IS NULL), 0) AS storage_used_mb,
        COALESCE((SELECT sum(uu.api_calls_today) FROM user_usage uu
           WHERE uu.tenant_id = ${tenantId}::uuid
             AND uu.deleted_at IS NULL
             AND uu.api_calls_date = CURRENT_DATE), 0) AS api_calls_count
    `);
    const rows = (result as { rows?: unknown[] }).rows;
    const row = (Array.isArray(rows) ? rows[0] : undefined) as
      | Record<string, string | number | null | undefined>
      | undefined;
    if (!row) return;
    measured.push({
      tenantId,
      usersCount: Number(row.users_count ?? 0),
      storageMb: String(row.storage_used_mb ?? 0),
      apiCalls: Number(row.api_calls_count ?? 0),
    });
  });

  let corrected = 0;
  if (measured.length > 0) {
    corrected = await withSecurityContext(async (tx) => {
      let total = 0;
      for (const m of measured) {
        const res = await tx.execute(sql`
          UPDATE usage_snapshots
             SET users_count = ${m.usersCount},
                 storage_used_mb = ${m.storageMb}::numeric,
                 api_calls_count = ${m.apiCalls},
                 updated_at = NOW()
           WHERE snapshot_date = CURRENT_DATE::text
             AND tenant_id = ${m.tenantId}::uuid
        `);
        total += res.rowCount ?? 0;
      }
      return total;
    });
  }
  return { corrected, sweep };
}

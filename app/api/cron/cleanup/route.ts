/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import {
  sessions, invitations, passwordResets,
  contacts, deals, companies, tasks, leads,
} from '@/drizzle/schema';
import { lt, and, isNull, eq, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { reconcileStaleImpersonations } from '@/lib/auth/impersonation-reconcile';
import { withSecurityContext } from '@/lib/db/rls';
import { sweepTenants } from '@/lib/cron/tenant-scope';

/**
 * POST /api/cron/cleanup — weekly (schedule: '0 4 * * 0').
 *
 * FIVE different kinds of row, in TWO different RLS contexts. Ground truth from
 * pg_policies (pre-prod):
 *
 *   sessions         sessions_security(ALL) USING is_super_admin
 *                    sessions_user_own(ALL) USING current_user = user_id
 *                    sessions_auth_lookup(SELECT)                 -> NO tenant branch
 *   password_resets  password_resets_security(ALL) USING is_super_admin
 *                    password_resets_user_own(ALL)                -> NO tenant branch
 *   invitations      tenant_isolation(ALL) USING tenant_id IS NULL
 *                                         OR tenant_id = current_tenant  -> NO super branch
 *   contacts/deals/companies/tasks
 *                    tenant_isolation(ALL) USING tenant_id = current_tenant
 *                                         OR is_super_admin                -> BOTH branches
 *   leads            tenant_isolation(ALL) USING tenant_id = current_tenant
 *                                         OR is_super_admin                -> BOTH branches
 *
 * So steps 1 and 3 can ONLY be reached with the platform context (they have no
 * tenant_id at all), and steps 2 and 4 can ONLY be reached with a tenant context
 * that invitations' policy admits. The old unscoped job therefore deleted nothing
 * anywhere and reported ok:true. Step 1+3 now run under withSecurityContext,
 * steps 2+4 run once per tenant under sweepTenants.
 *
 * STEP 4 IS PERMANENT DELETION — read this before firing the job.
 * public.purge_trash() is SECURITY INVOKER (verified: pg_proc.prosecdef = false),
 * so it deletes exactly what the CALLER's RLS admits, and its predicate is the
 * product's documented 30-day trash retention:
 *
 *   DELETE FROM <table> WHERE deleted_at IS NOT NULL
 *                          AND deleted_at < NOW() - interval '30 days'
 *   for contacts, deals, companies, tasks. NOT leads: the trash UI lists them
 *   but the function never purges them, so the sweep deletes past-retention
 *   leads itself with that same predicate (reported as leads_purged) rather
 *   than editing the stored function.
 *
 * Two safeguards live in the body below:
 *  1. app.is_super_admin is forced off for the sweep. requireAuth() sets it
 *     SESSION-scoped on the same connection withApiRoute pins for the whole
 *     request, and contacts/deals/companies/tasks honour that branch — leaving
 *     it set would let the FIRST tenant iteration purge every tenant's trash in
 *     one statement instead of its own.
 *  2. The eligible rows are counted first, with the identical predicate, and the
 *     destructive call is skipped when the count is 0. purge_trash() returns the
 *     number of TABLES it ran (it increments once per DELETE, unconditionally —
 *     always 4), never rows, so it cannot report its own blast radius. This
 *     route can, and does, as trash_rows_deleted.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  // Two ways to authorize this job:
  //  1. the scheduler presents the shared CRON_SECRET, or
  //  2. a logged-in super admin triggers it manually from the dashboard.
  // #1087: the superadmin path means the settings UI no longer needs to send a
  // cron secret from the browser (it previously sent an empty one).
  const secretOk = verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET);
  if (!secretOk) {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse || !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:cleanup', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    const r: Record<string, number> = {};

    // 1. Sessions cleanup (#1275) — platform context, see the header table.
    // Delete expired sessions in bounded batches instead of a single
    // unbounded DELETE. A single statement holds a write lock over every
    // matching row for the whole delete, which causes lock contention on a
    // large sessions table. Postgres DELETE has no LIMIT, so each batch
    // targets a capped subquery of ids. Each batch is its own short security
    // transaction (SET LOCAL drops at COMMIT) so lock hold time stays short AND
    // the platform privilege never outlives one batch.
    const SESSION_BATCH = 1000;
    const MAX_SESSION_ITERATIONS = 10000; // safety cap to avoid an infinite loop
    let sessionsDeleted = 0;
    for (let i = 0; i < MAX_SESSION_ITERATIONS; i++) {
      const removed = await withSecurityContext(async (tx) => {
        const batch = await tx.execute(sql`
          DELETE FROM ${sessions}
          WHERE ${sessions.id} IN (
            SELECT ${sessions.id} FROM ${sessions}
            WHERE ${sessions.expiresAt} < NOW()
            LIMIT ${SESSION_BATCH}
          )
        `);
        return batch.rowCount ?? 0;
      });
      sessionsDeleted += removed;
      if (removed === 0) break;
    }
    r['sessions'] = sessionsDeleted;

    // 2. Password resets cleanup — also platform context (user-scoped table,
    // no tenant_id branch to sweep against).
    r['resets'] = await withSecurityContext(async (tx) => {
      const resetsResult = await tx
        .delete(passwordResets)
        .where(lt(passwordResets.expiresAt, new Date()));
      return resetsResult.rowCount ?? 0;
    });

    // 3. Tenant-scoped work: expired invitations and the permanent trash purge.
    // Downgrade the connection BEFORE the sweep (same set_config the pool's own
    // release handler uses). Tightening only: nothing here widens any policy.
    await db.execute(sql`SELECT set_config('app.is_super_admin', 'false', false)`);

    const invExpiry = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let trashRows = 0;
    let trashPurgeRuns = 0;
    let leadsPurged = 0;

    const sweep = await sweepTenants('cron/cleanup', async (tenantId) => {
      // Invitations older than 7 days and never accepted.
      const invitationsResult = await db
        .delete(invitations)
        .where(and(
          eq(invitations.tenantId, tenantId),
          lt(invitations.expiresAt, invExpiry),
          isNull(invitations.acceptedAt),
        ));
      r['invitations'] = (r['invitations'] ?? 0) + (invitationsResult.rowCount ?? 0);

      // purge_trash() does NOT cover leads, so lead trash was never purged by
      // anything — same 30-day retention, applied here rather than editing the
      // stored function. lt() alone is the function's predicate: NULL deleted_at
      // never satisfies it, exactly as IS NOT NULL AND < NOW() - 30 days.
      try {
        const purgedLeads = await db
          .delete(leads)
          .where(and(
            eq(leads.tenantId, tenantId),
            lt(leads.deletedAt, sql`NOW() - interval '30 days'`),
          ));
        leadsPurged += purgedLeads.rowCount ?? 0;
      } catch (err) {
        void logError({ error: err, context: `cron/cleanup purge-leads tenant=${tenantId}`, level: 'warning' });
      }

      // Rows purge_trash() would permanently delete for THIS tenant. The
      // predicate below must stay byte-identical to the function's; the tables
      // have an is_super_admin branch but this context's is off, so the count is
      // scoped to tenantId and the sweep's own RLS does the bounding.
      const eligible = await db.execute(sql`
        SELECT
          (SELECT count(*) FROM ${contacts}
             WHERE ${contacts.deletedAt} IS NOT NULL
               AND ${contacts.deletedAt} < NOW() - interval '30 days')
        + (SELECT count(*) FROM ${deals}
             WHERE ${deals.deletedAt} IS NOT NULL
               AND ${deals.deletedAt} < NOW() - interval '30 days')
        + (SELECT count(*) FROM ${companies}
             WHERE ${companies.deletedAt} IS NOT NULL
               AND ${companies.deletedAt} < NOW() - interval '30 days')
        + (SELECT count(*) FROM ${tasks}
             WHERE ${tasks.deletedAt} IS NOT NULL
               AND ${tasks.deletedAt} < NOW() - interval '30 days') AS n
      `);
      const n = Number((eligible.rows[0] as { n?: number | string } | undefined)?.n ?? 0);
      if (!Number.isFinite(n) || n <= 0) return;

      try {
        // SECURITY INVOKER: deletes only this tenant's >30-day trash. Cascade
        // FKs mean child rows (activities, follow_ups, sequence_enrollments,
        // email_tracking, ...) go with them — that is the retention contract.
        await db.execute(sql`SELECT public.purge_trash()`);
        trashRows += n;
        trashPurgeRuns++;
      } catch (err) {
        // A NO ACTION FK from a non-tenant-scoped referrer (contact_merge_history,
        // ai_email_drafts) aborts the statement. Keep it non-fatal for the rest
        // of the fleet, but say so: the rows are still in trash, unrecoverable
        // only by fixing the referrer.
        void logError({ error: err, context: `cron/cleanup purge-trash tenant=${tenantId}`, level: 'warning' });
      }
    });

    r['trash_rows_deleted'] = trashRows;
    r['trash_purge_runs'] = trashPurgeRuns;
    r['leads_purged'] = leadsPurged;

    // 4. Reconcile stale impersonation memberships (#1911): impersonation
    // sessions past the 24h token TTL whose stop never ran get their
    // tenant_members upgrade reverted and are marked ended. Self-scoped — it
    // opens its own transactions with the exact contexts it needs.
    try {
      const { reconciled, failed } = await reconcileStaleImpersonations();
      r['impersonations_reconciled'] = reconciled;
      if (failed > 0) r['impersonations_failed'] = failed;
    } catch (err) {
      void logError({ error: err, context: 'cron/cleanup impersonation-reconcile', level: 'warning' });
      r['impersonations_reconciled'] = 0;
    }

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      cleaned: r,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/cleanup' });
    return apiError(err);
  }
});

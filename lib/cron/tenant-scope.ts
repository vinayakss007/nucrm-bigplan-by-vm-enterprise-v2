/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { clearTenantContext, setTenantContext, withSecurityContext } from '@/lib/db/rls';
import { withPinnedConnection } from '@/lib/db/request-connection';
import { logError } from '@/lib/errors-server';

/**
 * Per-tenant iteration for scheduled (cron) jobs.
 *
 * WHY THIS EXISTS
 * --------------
 * Every business table a cron job touches — support_tickets, sla_policies,
 * sla_breaches, scheduled_reports, service_subscriptions, contracts,
 * follow_ups, sequence_enrollments, tasks, notifications — carries a single
 * `tenant_isolation` policy:
 *
 *   USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid)
 *
 * with no super-admin branch. `lib/db/pool.ts` pins app.current_tenant to ''
 * on every checkout, so an unscoped job sees only the `tenant_id IS NULL` rows
 * — in practice zero (support_tickets has 0 such rows in pre-prod). The job
 * then reports a clean run while having examined nothing, which is worse than a
 * failure because it is indistinguishable from success.
 *
 * Setting app.is_super_admin (withSecurityContext) does NOT help: these policies
 * never look at that GUC. The only context that admits their rows is the
 * tenant's own, so a platform job has to run its body once per tenant.
 *
 * CONNECTION PINNING
 * ------------------
 * setTenantContext() writes a SESSION-scoped GUC, which is only visible to
 * later queries if they run on the same connection. The shared pool hands each
 * bare query its own checkout (and pre-prod sits behind PgBouncer), so the
 * sweep owns one pinned connection for its whole duration and every tenant's
 * context is set on that connection — including for helpers called by the body
 * (createNotification, sendEmail's preference lookup, etc.), which use `db`
 * themselves and cannot be passed a transaction.
 */

export type CronTenantSkipped = { tenantId: string; reason: string };
export type CronTenantFailure = { tenantId: string; error: string };

export type CronTenantSweep = {
  /** Tenants whose body ran to completion. */
  visited: number;
  /** Active tenants with no identity to act as — their data was NOT processed. */
  skipped: CronTenantSkipped[];
  /** Tenants whose body threw; the sweep continued with the rest. */
  failed: CronTenantFailure[];
};

type TenantRow = { tenant_id?: string | null; user_id?: string | null };

function asRows<T>(result: unknown): T[] {
  // db.execute() returns { rows } for raw SQL; the mocked client in unit tests
  // returns the array directly.
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Every non-suspended tenant, paired with a member to act as.
 *
 * `tenants` is readable from any context (tenants_read_all USING true), but
 * `tenant_members` is not, so the acting identity falls back to
 * users.last_tenant_id — which needs the platform context to read, hence the
 * one transaction. A tenant with no owner and nobody who has ever signed in
 * under it cannot host cron-owned rows, so it is reported as skipped rather
 * than silently processed under another tenant's identity.
 */
export async function listSweepableTenants(): Promise<{
  tenants: { tenantId: string; userId: string }[];
  skipped: CronTenantSkipped[];
}> {
  const result = await withSecurityContext((tx) => tx.execute(sql`
    SELECT t.id AS tenant_id,
           COALESCE(
             t.owner_id,
             (SELECT u.id FROM users u
               WHERE u.last_tenant_id = t.id
               ORDER BY u.created_at
               LIMIT 1)
           ) AS user_id
    FROM tenants t
    WHERE t.status <> 'suspended'
    ORDER BY t.created_at
  `));

  const tenants: { tenantId: string; userId: string }[] = [];
  const skipped: CronTenantSkipped[] = [];
  for (const row of asRows<TenantRow>(result)) {
    if (!row.tenant_id) continue;
    if (!row.user_id) {
      skipped.push({ tenantId: row.tenant_id, reason: 'no-acting-user' });
      continue;
    }
    tenants.push({ tenantId: row.tenant_id, userId: row.user_id });
  }
  return { tenants, skipped };
}

/**
 * Re-resolve the identity to act as, now that this tenant's rows are readable.
 *
 * listSweepableTenants() can only see tenants/users, so it guesses from
 * owner_id / users.last_tenant_id. That guess is not always a *member*: `users`
 * is guarded by users_tenant_member_read, which admits a reader only when
 * app.current_user is an active row of that tenant's tenant_members. Acting as a
 * non-member therefore reads zero users and zero members, and a job that joins
 * them (task reminders, renewal digests, SLA escalations) notifies nobody while
 * still reporting a clean run. tenant_members IS visible under the tenant's own
 * GUC, so prefer a real active member — the guessed user when they are one,
 * otherwise the longest-serving member.
 */
async function resolveActingUser(tenantId: string, preferredUserId: string): Promise<string> {
  const result = await db.execute(sql`
    SELECT user_id FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    ORDER BY (user_id = ${preferredUserId}::uuid) DESC, created_at
    LIMIT 1
  `);
  return asRows<{ user_id?: string | null }>(result)[0]?.user_id ?? preferredUserId;
}

/**
 * Run `body` once for every active tenant, under that tenant's own RLS context.
 *
 * A throw in one tenant is recorded and does not stop the sweep — the other
 * tenants' SLAs, renewals and sequences still need their run. The caller gets
 * the skipped/failed lists back and should surface them: a green cron response
 * that quietly covered nobody is the bug this module exists to fix.
 */
export async function sweepTenants(
  context: string,
  body: (tenantId: string) => Promise<void>,
): Promise<CronTenantSweep> {
  const sweep: CronTenantSweep = { visited: 0, skipped: [], failed: [] };

  await withPinnedConnection(async () => {
    const { tenants, skipped } = await listSweepableTenants();
    sweep.skipped.push(...skipped);

    for (const tenant of tenants) {
      try {
        await setTenantContext(tenant.tenantId, tenant.userId);
        let actingUserId = tenant.userId;
        try {
          actingUserId = await resolveActingUser(tenant.tenantId, tenant.userId);
        } catch (err) {
          // Membership could not be confirmed — run as the guessed identity
          // rather than dropping the tenant, but make the guess visible.
          void logError({ error: err, context: `${context} resolve-member tenant=${tenant.tenantId}` });
        }
        if (actingUserId !== tenant.userId) {
          await setTenantContext(tenant.tenantId, actingUserId);
        }
        await body(tenant.tenantId);
        sweep.visited++;
      } catch (err) {
        void logError({ error: err, context: `${context} tenant=${tenant.tenantId}` });
        sweep.failed.push({
          tenantId: tenant.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Never leave one tenant's GUCs on the connection the next tenant runs on.
        await clearTenantContext().catch((err: unknown) => {
          void logError({ error: err, context: `${context} clear-tenant-context` });
        });
      }
    }
  });

  return sweep;
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { contacts, companies, deals, tasks, leads, platformSettings } from '@/drizzle/schema';
import { eq, and, isNotNull, lt, count } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { withTenantContext } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';

const TRASH_RETENTION_KEY = 'trash_retention_days';

/**
 * `count(*)` is `int8`, and node-postgres returns `int8` as a decimal string — this repo
 * registers no `pg.setTypeParser` (#2774). So the number these responses promise is made
 * here, at the boundary that makes the promise: `#2826` summed five of those strings with
 * `+` and answered `"32014"` for 10 pending records.
 */
function toCount(rows: { count?: unknown }[] | undefined): number {
  const value = Number(rows?.[0]?.count);
  return Number.isFinite(value) ? value : 0;
}

async function getRetentionDays(tenantId: string, userId: string): Promise<number> {
  // #3300: `platform_settings` is tenant-scoped and FORCE-RLS, so this read answered zero rows on
  // the pool and every workspace silently got the built-in 30 regardless of what its admin set.
  const [setting] = await withTenantContext(tenantId, userId, (tx) =>
    tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(eq(platformSettings.tenantId, tenantId), eq(platformSettings.key, TRASH_RETENTION_KEY)))
      .limit(1),
  );
  return setting ? parseInt(String(setting.value)) : 30;
}

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const retentionDays = await getRetentionDays(ctx.tenantId, ctx.userId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const _deletedCount = {
      contacts: 0,
      companies: 0,
      deals: 0,
      tasks: 0,
      leads: 0
    };

    // #3300: the app-level `tenant_id` predicate below is correct, and that is exactly the trap — RLS
    // narrows the row set before any predicate runs, and `lib/db/request-connection.ts` is explicit
    // that the pin `requireAuth()` applies does not reach handler-level queries in the caller's scope.
    // On a connection with no `app.current_tenant` the DELETE's input was empty whatever the `where`
    // said, so the endpoint answered `cleaned_up: 0` for a full trash.
    const [contactResult, companyResult, dealResult, taskResult, leadResult] = await withTenantContext(ctx.tenantId, ctx.userId, async (tx) => {
      return await Promise.all([
        tx.delete(contacts).where(and(
          eq(contacts.tenantId, ctx.tenantId),
          isNotNull(contacts.deletedAt),
          lt(contacts.deletedAt, cutoffDate)
        )),
        tx.delete(companies).where(and(
          eq(companies.tenantId, ctx.tenantId),
          isNotNull(companies.deletedAt),
          lt(companies.deletedAt, cutoffDate)
        )),
        tx.delete(deals).where(and(
          eq(deals.tenantId, ctx.tenantId),
          isNotNull(deals.deletedAt),
          lt(deals.deletedAt, cutoffDate)
        )),
        tx.delete(tasks).where(and(
          eq(tasks.tenantId, ctx.tenantId),
          isNotNull(tasks.deletedAt),
          lt(tasks.deletedAt, cutoffDate)
        )),
        tx.delete(leads).where(and(
          eq(leads.tenantId, ctx.tenantId),
          isNotNull(leads.deletedAt),
          lt(leads.deletedAt, cutoffDate)
        ))
      ]);
    });

 
 
    // The count half had the same shape and is the one an admin reads: with no context
    // `remaining_in_trash` answered 0 for a tenant whose trash is full, so the screen that exists to
    // prove retention is enforced reported "0 cleaned up, 0 remaining". Both numbers were failures,
    // not a failure and an empty trash.
    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await withTenantContext(ctx.tenantId, ctx.userId, async (tx) => {
      const countQuery = (table: typeof contacts | typeof companies | typeof deals | typeof tasks | typeof leads) =>
        tx
          .select({ count: count() })
          .from(table)
          .where(and(eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt)));

      return await Promise.all([
        countQuery(contacts),
        countQuery(companies),
        countQuery(deals),
        countQuery(tasks),
        countQuery(leads),
      ]);
    });

    return NextResponse.json({
      cleaned_up: {
        contacts: contactResult.rowCount || 0,
        companies: companyResult.rowCount || 0,
        deals: dealResult.rowCount || 0,
        tasks: taskResult.rowCount || 0,
        leads: leadResult.rowCount || 0
      },
      remaining_in_trash: {
        contacts: toCount(contactCount),
        companies: toCount(companyCount),
        deals: toCount(dealCount),
        tasks: toCount(taskCount),
        leads: toCount(leadCount)
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString()
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'trash-auto-cleanup', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const retentionDays = await getRetentionDays(ctx.tenantId, ctx.userId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Same #3300 shape as the POST counts: this is the status screen, and on a connection with no
    // `app.current_tenant` it promised the admin there was nothing pending in a tenant whose trash was
    // full of expired rows.
    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await withTenantContext(ctx.tenantId, ctx.userId, async (tx) => {
      const pendingQuery = (table: typeof contacts | typeof companies | typeof deals | typeof tasks | typeof leads) =>
        tx
          .select({ count: count() })
          .from(table)
          .where(and(eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt), lt(table.deletedAt, cutoffDate)));

      return await Promise.all([
        pendingQuery(contacts),
        pendingQuery(companies),
        pendingQuery(deals),
        pendingQuery(tasks),
        pendingQuery(leads),
      ]);
    });

    const pending = {
      contacts: toCount(contactCount),
      companies: toCount(companyCount),
      deals: toCount(dealCount),
      tasks: toCount(taskCount),
      leads: toCount(leadCount)
    };

    return NextResponse.json({
      pending_deletion: {
        ...pending,
        total: Object.values(pending).reduce((sum, n) => sum + n, 0)
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString()
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'trash-cleanup-status', requestMethod: 'GET' });
    return apiError(err);
  }
});
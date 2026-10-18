/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads, platformSettings } from '@/drizzle/schema';
import { eq, and, isNotNull, lt, count } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
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

async function getRetentionDays(tenantId: string): Promise<number> {
  const [setting] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, TRASH_RETENTION_KEY)
    ))
    .limit(1);
  return setting ? parseInt(String(setting.value)) : 30;
}

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const retentionDays = await getRetentionDays(ctx.tenantId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const _deletedCount = {
      contacts: 0,
      companies: 0,
      deals: 0,
      tasks: 0,
      leads: 0
    };

    const [contactResult, companyResult, dealResult, taskResult, leadResult] = await db.transaction(async (tx) => {
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

 
 
    const countQuery = (
      table: typeof contacts | typeof companies | typeof deals | typeof tasks | typeof leads,
      tenantId: string
    ) => 
      db.select({ count: count() })
        .from(table)
        .where(and(eq(table.tenantId, tenantId), isNotNull(table.deletedAt)));

    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await Promise.all([
      countQuery(contacts, ctx.tenantId),
      countQuery(companies, ctx.tenantId),
      countQuery(deals, ctx.tenantId),
      countQuery(tasks, ctx.tenantId),
      countQuery(leads, ctx.tenantId)
    ]);

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

    const retentionDays = await getRetentionDays(ctx.tenantId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await Promise.all([
      db.select({ count: count() })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), isNotNull(contacts.deletedAt), lt(contacts.deletedAt, cutoffDate))),
      db.select({ count: count() })
        .from(companies)
        .where(and(eq(companies.tenantId, ctx.tenantId), isNotNull(companies.deletedAt), lt(companies.deletedAt, cutoffDate))),
      db.select({ count: count() })
        .from(deals)
        .where(and(eq(deals.tenantId, ctx.tenantId), isNotNull(deals.deletedAt), lt(deals.deletedAt, cutoffDate))),
      db.select({ count: count() })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoffDate))),
      db.select({ count: count() })
        .from(leads)
        .where(and(eq(leads.tenantId, ctx.tenantId), isNotNull(leads.deletedAt), lt(leads.deletedAt, cutoffDate)))
    ]);

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
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads, platformSettings } from '@/drizzle/schema';
import { eq, and, isNotNull, lt, sql } from 'drizzle-orm';

const TRASH_RETENTION_KEY = 'trash_retention_days';

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

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const retentionDays = await getRetentionDays(ctx.tenantId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedCount = {
      contacts: 0,
      companies: 0,
      deals: 0,
      tasks: 0,
      leads: 0
    };

    const [contactResult, companyResult, dealResult, taskResult, leadResult] = await Promise.all([
      db.delete(contacts).where(and(
        eq(contacts.tenantId, ctx.tenantId),
        isNotNull(contacts.deletedAt),
        lt(contacts.deletedAt, cutoffDate)
      )),
      db.delete(companies).where(and(
        eq(companies.tenantId, ctx.tenantId),
        isNotNull(companies.deletedAt),
        lt(companies.deletedAt, cutoffDate)
      )),
      db.delete(deals).where(and(
        eq(deals.tenantId, ctx.tenantId),
        isNotNull(deals.deletedAt),
        lt(deals.deletedAt, cutoffDate)
      )),
      db.delete(tasks).where(and(
        eq(tasks.tenantId, ctx.tenantId),
        isNotNull(tasks.deletedAt),
        lt(tasks.deletedAt, cutoffDate)
      )),
      db.delete(leads).where(and(
        eq(leads.tenantId, ctx.tenantId),
        isNotNull(leads.deletedAt),
        lt(leads.deletedAt, cutoffDate)
      ))
    ]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countQuery = (table: any, tenantId: string) => 
      db.select({ count: sql<number>`count(*)` })
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
        contacts: contactCount[0]?.count || 0,
        companies: companyCount[0]?.count || 0,
        deals: dealCount[0]?.count || 0,
        tasks: taskCount[0]?.count || 0,
        leads: leadCount[0]?.count || 0
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString()
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[trash-auto-cleanup]', err);
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const retentionDays = await getRetentionDays(ctx.tenantId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), isNotNull(contacts.deletedAt), lt(contacts.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(companies)
        .where(and(eq(companies.tenantId, ctx.tenantId), isNotNull(companies.deletedAt), lt(companies.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(deals)
        .where(and(eq(deals.tenantId, ctx.tenantId), isNotNull(deals.deletedAt), lt(deals.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(eq(leads.tenantId, ctx.tenantId), isNotNull(leads.deletedAt), lt(leads.deletedAt, cutoffDate)))
    ]);

    const pendingDeletion = 
      (contactCount[0]?.count || 0) +
      (companyCount[0]?.count || 0) +
      (dealCount[0]?.count || 0) +
      (taskCount[0]?.count || 0) +
      (leadCount[0]?.count || 0);

    return NextResponse.json({
      pending_deletion: {
        contacts: contactCount[0]?.count || 0,
        companies: companyCount[0]?.count || 0,
        deals: dealCount[0]?.count || 0,
        tasks: taskCount[0]?.count || 0,
        leads: leadCount[0]?.count || 0,
        total: pendingDeletion
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString()
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[trash-cleanup-status]', err);
    return apiError(err);
  }
}
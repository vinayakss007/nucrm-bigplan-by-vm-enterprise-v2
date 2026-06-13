import { NextRequest, NextResponse } from 'next/server';
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { contacts, deals, invoices, orders } from '@/drizzle/schema';
import { eq, and, sql, gte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantCtx();
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';

    let dateFilter: any;
    const now = new Date();
    switch (period) {
      case '7d':
        dateFilter = gte(contacts.createdAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        break;
      case '30d':
        dateFilter = gte(contacts.createdAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        break;
      case '90d':
        dateFilter = gte(contacts.createdAt, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
        break;
      case '12m':
        dateFilter = gte(contacts.createdAt, new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000));
        break;
    }

    const [contactsCount, dealsCount, invoicesResult, ordersResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(contacts).where(and(eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`)),
      db.select({ count: sql<number>`count(*)` }).from(deals).where(and(eq(deals.tenantId, ctx.tenantId), sql`${deals.deletedAt} IS NULL`)),
      db.select({ total: sql<number>`COALESCE(sum(total_amount::numeric), 0)` }).from(invoices).where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.status, 'paid'))),
      db.select({ total: sql<number>`COALESCE(sum(total_amount::numeric), 0)` }).from(orders).where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.status, 'delivered'))),
    ]);

    const revenue = Number(invoicesResult[0]?.total || 0) + Number(ordersResult[0]?.total || 0);
    const dealsWithWon = await db.select({ count: sql<number>`count(*)` }).from(deals).where(and(eq(deals.tenantId, ctx.tenantId), eq(deals.stageId, sql`'won'`)));
    const winRate = (dealsCount[0]?.count ?? 0) > 0 ? (Number(dealsWithWon[0]?.count || 0) / Number(dealsCount[0]?.count || 1)) * 100 : 0;

    return NextResponse.json({
      data: {
        contacts: Number(contactsCount[0]?.count || 0),
        deals: Number(dealsCount[0]?.count || 0),
        revenue,
        winRate: winRate.toFixed(1),
        contactsChange: 12,
        dealsChange: 8,
        revenueChange: 15,
        winRateChange: 5,
      }
    });
  } catch (error) {
    console.error('[analytics/stats/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, supportTickets, companies, activities, emailLog } from '@/drizzle/schema';
import { eq, and, sql, gte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Current month counts
    const [thisMonthContacts] = await db.select({ count: sql<number>`count(*)::int` })
      .from(contacts).where(and(eq(contacts.tenantId, ctx.tenantId), gte(contacts.createdAt, thisMonthStart)));
    const [thisMonthDeals] = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals).where(and(eq(deals.tenantId, ctx.tenantId), gte(deals.createdAt, thisMonthStart)));
    const [thisMonthTasks] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), gte(tasks.createdAt, thisMonthStart)));
    const [thisMonthTickets] = await db.select({ count: sql<number>`count(*)::int` })
      .from(supportTickets).where(and(eq(supportTickets.tenantId, ctx.tenantId), gte(supportTickets.createdAt, thisMonthStart)));
    const [thisMonthCompanies] = await db.select({ count: sql<number>`count(*)::int` })
      .from(companies).where(and(eq(companies.tenantId, ctx.tenantId), gte(companies.createdAt, thisMonthStart)));
    const [thisMonthEmails] = await db.select({ count: sql<number>`count(*)::int` })
      .from(emailLog).where(and(eq(emailLog.tenantId, ctx.tenantId), gte(emailLog.createdAt, thisMonthStart)));

    // Last month counts
    const [lastMonthContacts] = await db.select({ count: sql<number>`count(*)::int` })
      .from(contacts).where(and(eq(contacts.tenantId, ctx.tenantId), gte(contacts.createdAt, lastMonthStart), sql`${contacts.createdAt} < ${lastMonthEnd}`));
    const [lastMonthDeals] = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals).where(and(eq(deals.tenantId, ctx.tenantId), gte(deals.createdAt, lastMonthStart), sql`${deals.createdAt} < ${lastMonthEnd}`));
    const [lastMonthTasks] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), gte(tasks.createdAt, lastMonthStart), sql`${tasks.createdAt} < ${lastMonthEnd}`));

    // Total counts
    const [totalContacts] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.tenantId, ctx.tenantId));
    const [totalDeals] = await db.select({ count: sql<number>`count(*)::int` }).from(deals).where(eq(deals.tenantId, ctx.tenantId));
    const [totalTasks] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.tenantId, ctx.tenantId));
    const [totalTickets] = await db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.tenantId, ctx.tenantId));
    const [totalCompanies] = await db.select({ count: sql<number>`count(*)::int` }).from(companies).where(eq(companies.tenantId, ctx.tenantId));

    // Deal value
    const [thisMonthDealValue] = await db.select({ total: sql<string>`coalesce(sum(${deals.amount})::numeric, 0)` })
      .from(deals).where(and(eq(deals.tenantId, ctx.tenantId), gte(deals.createdAt, thisMonthStart)));
    const [totalDealValue] = await db.select({ total: sql<string>`coalesce(sum(${deals.amount})::numeric, 0)` })
      .from(deals).where(eq(deals.tenantId, ctx.tenantId));

    // Deals won this month
    const [dealsWon] = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals).where(and(eq(deals.tenantId, ctx.tenantId), eq(deals.status, 'won'), gte(deals.createdAt, thisMonthStart)));

    // Recent activity
    const recentActivity = await db.select({
      id: activities.id,
      description: activities.description,
      eventType: activities.eventType,
      entityType: activities.entityType,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(and(eq(activities.tenantId, ctx.tenantId), sql`${activities.deletedAt} is null`))
    .orderBy(sql`${activities.createdAt} desc`)
    .limit(20);

    return NextResponse.json({
      data: {
        thisMonth: {
          contacts: thisMonthContacts?.count ?? 0,
          deals: thisMonthDeals?.count ?? 0,
          tasks: thisMonthTasks?.count ?? 0,
          tickets: thisMonthTickets?.count ?? 0,
          companies: thisMonthCompanies?.count ?? 0,
          emails: thisMonthEmails?.count ?? 0,
          dealValue: Number(thisMonthDealValue?.total ?? 0),
          dealsWon: dealsWon?.count ?? 0,
        },
        lastMonth: {
          contacts: lastMonthContacts?.count ?? 0,
          deals: lastMonthDeals?.count ?? 0,
          tasks: lastMonthTasks?.count ?? 0,
        },
        totals: {
          contacts: totalContacts?.count ?? 0,
          deals: totalDeals?.count ?? 0,
          tasks: totalTasks?.count ?? 0,
          tickets: totalTickets?.count ?? 0,
          companies: totalCompanies?.count ?? 0,
          dealValue: Number(totalDealValue?.total ?? 0),
        },
        recentActivity,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}

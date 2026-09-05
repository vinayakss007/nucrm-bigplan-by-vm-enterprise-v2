/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, supportTickets, companies, activities, emailLog } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitRead } from '@/lib/api/read-rate-limit';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitRead(request, 'analytics');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Single round-trip aggregate: 17 serial counts used to cost ~17x WAN
    // RTT (~4s against a remote DB) while holding a pinned pool connection.
    // One statement with scalar subselects returns the identical shape.
    const aggRes = await db.execute<{
      thisMonthContacts: number; thisMonthDeals: number; thisMonthTasks: number;
      thisMonthTickets: number; thisMonthCompanies: number; thisMonthEmails: number;
      lastMonthContacts: number; lastMonthDeals: number; lastMonthTasks: number;
      totalContacts: number; totalDeals: number; totalTasks: number;
      totalTickets: number; totalCompanies: number;
      thisMonthDealValue: string; totalDealValue: string;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${contacts} WHERE ${contacts.tenantId} = ${ctx.tenantId} AND ${contacts.createdAt} >= ${thisMonthStart} AND ${contacts.deletedAt} IS NULL) AS "thisMonthContacts",
        (SELECT count(*)::int FROM ${deals} WHERE ${deals.tenantId} = ${ctx.tenantId} AND ${deals.createdAt} >= ${thisMonthStart} AND ${deals.deletedAt} IS NULL) AS "thisMonthDeals",
        (SELECT count(*)::int FROM ${tasks} WHERE ${tasks.tenantId} = ${ctx.tenantId} AND ${tasks.createdAt} >= ${thisMonthStart} AND ${tasks.deletedAt} IS NULL) AS "thisMonthTasks",
        (SELECT count(*)::int FROM ${supportTickets} WHERE ${supportTickets.tenantId} = ${ctx.tenantId} AND ${supportTickets.createdAt} >= ${thisMonthStart}) AS "thisMonthTickets",
        (SELECT count(*)::int FROM ${companies} WHERE ${companies.tenantId} = ${ctx.tenantId} AND ${companies.createdAt} >= ${thisMonthStart} AND ${companies.deletedAt} IS NULL) AS "thisMonthCompanies",
        (SELECT count(*)::int FROM ${emailLog} WHERE ${emailLog.tenantId} = ${ctx.tenantId} AND ${emailLog.createdAt} >= ${thisMonthStart}) AS "thisMonthEmails",
        (SELECT count(*)::int FROM ${contacts} WHERE ${contacts.tenantId} = ${ctx.tenantId} AND ${contacts.createdAt} >= ${lastMonthStart} AND ${contacts.createdAt} < ${lastMonthEnd}) AS "lastMonthContacts",
        (SELECT count(*)::int FROM ${deals} WHERE ${deals.tenantId} = ${ctx.tenantId} AND ${deals.createdAt} >= ${lastMonthStart} AND ${deals.createdAt} < ${lastMonthEnd}) AS "lastMonthDeals",
        (SELECT count(*)::int FROM ${tasks} WHERE ${tasks.tenantId} = ${ctx.tenantId} AND ${tasks.createdAt} >= ${lastMonthStart} AND ${tasks.createdAt} < ${lastMonthEnd}) AS "lastMonthTasks",
        (SELECT count(*)::int FROM ${contacts} WHERE ${contacts.tenantId} = ${ctx.tenantId} AND ${contacts.deletedAt} IS NULL) AS "totalContacts",
        (SELECT count(*)::int FROM ${deals} WHERE ${deals.tenantId} = ${ctx.tenantId} AND ${deals.deletedAt} IS NULL) AS "totalDeals",
        (SELECT count(*)::int FROM ${tasks} WHERE ${tasks.tenantId} = ${ctx.tenantId} AND ${tasks.deletedAt} IS NULL) AS "totalTasks",
        (SELECT count(*)::int FROM ${supportTickets} WHERE ${supportTickets.tenantId} = ${ctx.tenantId}) AS "totalTickets",
        (SELECT count(*)::int FROM ${companies} WHERE ${companies.tenantId} = ${ctx.tenantId} AND ${companies.deletedAt} IS NULL) AS "totalCompanies",
        (SELECT coalesce(sum(${deals.amount})::numeric, 0) FROM ${deals} WHERE ${deals.tenantId} = ${ctx.tenantId} AND ${deals.createdAt} >= ${thisMonthStart} AND ${deals.deletedAt} IS NULL) AS "thisMonthDealValue",
        (SELECT coalesce(sum(${deals.amount})::numeric, 0) FROM ${deals} WHERE ${deals.tenantId} = ${ctx.tenantId} AND ${deals.deletedAt} IS NULL) AS "totalDealValue"
    `);
    const agg = aggRes.rows[0];

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
          contacts: agg?.thisMonthContacts ?? 0,
          deals: agg?.thisMonthDeals ?? 0,
          tasks: agg?.thisMonthTasks ?? 0,
          tickets: agg?.thisMonthTickets ?? 0,
          companies: agg?.thisMonthCompanies ?? 0,
          emails: agg?.thisMonthEmails ?? 0,
          dealValue: Number(agg?.thisMonthDealValue ?? 0),
        },
        lastMonth: {
          contacts: agg?.lastMonthContacts ?? 0,
          deals: agg?.lastMonthDeals ?? 0,
          tasks: agg?.lastMonthTasks ?? 0,
        },
        totals: {
          contacts: agg?.totalContacts ?? 0,
          deals: agg?.totalDeals ?? 0,
          tasks: agg?.totalTasks ?? 0,
          tickets: agg?.totalTickets ?? 0,
          companies: agg?.totalCompanies ?? 0,
          dealValue: Number(agg?.totalDealValue ?? 0),
        },
        recentActivity,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});

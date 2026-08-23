/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { csatSurveys, supportTickets, users } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') ?? '30')));

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Overall stats
    const [overall] = await db.select({
      total: sql<number>`count(*)::int`,
      responded: sql<number>`count(${csatSurveys.respondedAt})::int`,
      avgScore: sql<number>`coalesce(avg(${csatSurveys.score}), 0)::numeric(3,2)`,
    })
    .from(csatSurveys)
    .where(and(
      eq(csatSurveys.tenantId, ctx.tenantId),
      sql`${csatSurveys.createdAt} >= ${since}`
    ));

    // Score distribution
    const distribution = await db.select({
      score: csatSurveys.score,
      count: sql<number>`count(*)::int`,
    })
    .from(csatSurveys)
    .where(and(
      eq(csatSurveys.tenantId, ctx.tenantId),
      sql`${csatSurveys.createdAt} >= ${since}`,
      sql`${csatSurveys.score} is not null`
    ))
    .groupBy(csatSurveys.score)
    .orderBy(csatSurveys.score);

    // Recent surveys with ticket info
    const recent = await db.select({
      id: csatSurveys.id,
      score: csatSurveys.score,
      comment: csatSurveys.comment,
      sentAt: csatSurveys.sentAt,
      respondedAt: csatSurveys.respondedAt,
      ticketSubject: supportTickets.subject,
      agentName: users.fullName,
    })
    .from(csatSurveys)
    .leftJoin(supportTickets, eq(supportTickets.id, csatSurveys.ticketId))
    .leftJoin(users, eq(users.id, supportTickets.assignedTo))
    .where(and(
      eq(csatSurveys.tenantId, ctx.tenantId),
      sql`${csatSurveys.createdAt} >= ${since}`
    ))
    .orderBy(desc(csatSurveys.createdAt))
    .limit(50);

    return NextResponse.json({
      data: {
        overall: {
          total: overall?.total ?? 0,
          responded: overall?.responded ?? 0,
          responseRate: overall?.total ? Math.round(((overall?.responded ?? 0) / overall.total) * 100) : 0,
          avgScore: Number(overall?.avgScore ?? 0),
        },
        distribution,
        recent,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}

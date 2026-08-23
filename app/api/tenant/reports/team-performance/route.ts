/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, users, teams } from '@/drizzle/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

// GET /api/tenant/reports/team-performance
// Lead performance broken down by rep and by team, so a manager can see who was
// given what, how much converted, and the pipeline value each carries — the
// "see progress in reports" gap (docs/workflow-gaps.md WF-06). Handoff history
// lives in lead_assignments and can be layered on later.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const base = and(eq(leads.tenantId, ctx.tenantId), isNull(leads.deletedAt));

    // Per rep.
    const byRep = await db
      .select({
        userId: leads.assignedTo,
        name: users.fullName,
        email: users.email,
        total: sql<number>`count(*)::int`,
        converted: sql<number>`count(*) filter (where ${leads.isConverted})::int`,
        open: sql<number>`count(*) filter (where not ${leads.isConverted} and ${leads.leadStatus} not in ('rejected','junk','archived','unqualified'))::int`,
        pipelineValue: sql<string>`coalesce(sum(${leads.value}) filter (where not ${leads.isConverted}), 0)`,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedTo))
      .where(base)
      .groupBy(leads.assignedTo, users.fullName, users.email);

    // Per team.
    const byTeam = await db
      .select({
        teamId: leads.teamId,
        name: teams.name,
        total: sql<number>`count(*)::int`,
        converted: sql<number>`count(*) filter (where ${leads.isConverted})::int`,
        open: sql<number>`count(*) filter (where not ${leads.isConverted} and ${leads.leadStatus} not in ('rejected','junk','archived','unqualified'))::int`,
        pipelineValue: sql<string>`coalesce(sum(${leads.value}) filter (where not ${leads.isConverted}), 0)`,
      })
      .from(leads)
      .leftJoin(teams, eq(teams.id, leads.teamId))
      .where(base)
      .groupBy(leads.teamId, teams.name);

    const withRate = <T extends { total: number; converted: number }>(rows: T[]) =>
      rows.map((r) => ({
        ...r,
        conversionRate: r.total > 0 ? Math.round((r.converted / r.total) * 100) : 0,
      }));

    return NextResponse.json({
      data: {
        byRep: withRate(
          byRep.map((r) => ({
            userId: r.userId,
            name: r.name ?? r.email ?? 'Unassigned',
            total: r.total,
            converted: r.converted,
            open: r.open,
            pipelineValue: r.pipelineValue,
          })),
        ),
        byTeam: withRate(
          byTeam.map((r) => ({
            teamId: r.teamId,
            name: r.name ?? 'No team',
            total: r.total,
            converted: r.converted,
            open: r.open,
            pipelineValue: r.pipelineValue,
          })),
        ),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

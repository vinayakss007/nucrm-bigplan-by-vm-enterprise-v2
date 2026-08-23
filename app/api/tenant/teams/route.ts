/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { teams, teamMembers } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

// GET /api/tenant/teams — list teams with a live member count.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        managerId: teams.managerId,
        isActive: teams.isActive,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
        memberCount: sql<number>`(
          SELECT count(*)::int FROM team_members tm
          WHERE tm.team_id = ${teams.id} AND tm.deleted_at IS NULL
        )`,
      })
      .from(teams)
      .where(and(eq(teams.tenantId, ctx.tenantId), isNull(teams.deletedAt)))
      .orderBy(teams.name);

    return NextResponse.json({ data: rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// POST /api/tenant/teams — create a team (admin only).
export async function POST(req: NextRequest) {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    // Reject a duplicate name up front for a clean 409 instead of a DB error.
    const [existing] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tenantId, ctx.tenantId), eq(teams.name, name), isNull(teams.deletedAt)))
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: 'A team with this name already exists' }, { status: 409 });
    }

    // Wrap team + member creation in a transaction so we never get
    // a team without its manager member (partial write).
    const [team] = await db.transaction(async (tx) => {
      const [newTeam] = await tx.insert(teams).values({
        tenantId: ctx.tenantId,
        name,
        description: typeof body?.description === 'string' ? body.description : null,
        managerId: body?.managerId || null,
        isActive: true,
        createdBy: ctx.userId,
      }).returning();

      // If a manager was named, enrol them as a manager member so the team is
      // never created with an empty roster it silently cannot assign to.
      if (newTeam && body?.managerId) {
        await tx.insert(teamMembers).values({
          tenantId: ctx.tenantId,
          teamId: newTeam.id,
          userId: body.managerId,
          role: 'manager',
          createdBy: ctx.userId,
        }).onConflictDoNothing();
      }

      return [newTeam];
    });

    return NextResponse.json({ data: team }, { status: 201 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

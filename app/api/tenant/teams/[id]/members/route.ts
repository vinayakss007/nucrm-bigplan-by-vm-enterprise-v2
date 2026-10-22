/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { teams, teamMembers } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

async function loadTeam(tenantId: string, id: string) {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId), isNull(teams.deletedAt)))
    .limit(1);
  return team;
}

// POST /api/tenant/teams/:id/members — add (or re-activate) a member (admin only).
export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const teamId = (await params).id;

    const team = await loadTeam(ctx.tenantId, teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const body = await readJsonBody(req);
    const userId = body?.userId;
    const role = body?.role === 'manager' ? 'manager' : 'member';
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    // One statement, no read-then-insert window (#3082): re-activating a
    // previously-removed membership is an on-conflict update of the same
    // row the idx_team_members_team_user unique index protects. A
    // double-submit used to take the insert branch twice and the loser got
    // a raw 23505 → 500. Same pattern as accept-invite (#89-98).
    const [member] = await db
      .insert(teamMembers)
      .values({
        tenantId: ctx.tenantId,
        teamId,
        userId,
        role,
        createdBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [teamMembers.teamId, teamMembers.userId],
        set: { role, deletedAt: null, updatedAt: new Date(), updatedBy: ctx.userId },
      })
      .returning();

    return NextResponse.json({ data: member }, { status: 201 });
  } catch (err) { return apiError(err); }
});

// DELETE /api/tenant/teams/:id/members?userId=... — remove a member (admin only).
export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const teamId = (await params).id;

    const userId = new URL(req.url).searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });

    const [removed] = await db.update(teamMembers)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() })
      .where(and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.tenantId, ctx.tenantId),
        isNull(teamMembers.deletedAt),
      ))
      .returning();
    if (!removed) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    return NextResponse.json({ data: { teamId, userId, removed: true } });
  } catch (err) { return apiError(err); }
});

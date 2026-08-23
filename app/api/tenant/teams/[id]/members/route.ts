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
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

async function loadTeam(tenantId: string, id: string) {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId), isNull(teams.deletedAt)))
    .limit(1);
  return team;
}

// POST /api/tenant/teams/:id/members — add (or re-activate) a member (admin only).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const teamId = (await params).id;

    const team = await loadTeam(ctx.tenantId, teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const body = await req.json();
    const userId = body?.userId;
    const role = body?.role === 'manager' ? 'manager' : 'member';
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    // Re-activate a previously-removed membership rather than creating a second
    // row (the unique index is on team_id+user_id).
    const [existing] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .limit(1);

    let member;
    if (existing) {
      [member] = await db.update(teamMembers)
        .set({ role, deletedAt: null, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(teamMembers.id, existing.id))
        .returning();
    } else {
      [member] = await db.insert(teamMembers).values({
        tenantId: ctx.tenantId,
        teamId,
        userId,
        role,
        createdBy: ctx.userId,
      }).returning();
    }

    return NextResponse.json({ data: member }, { status: 201 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// DELETE /api/tenant/teams/:id/members?userId=... — remove a member (admin only).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

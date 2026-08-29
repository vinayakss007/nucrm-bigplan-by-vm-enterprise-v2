/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { teams, teamMembers, users } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

// GET /api/tenant/teams/:id — team detail with its members.
export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = (await params).id;

    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.tenantId, ctx.tenantId), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const members = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        name: users.fullName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(teamMembers)
      .leftJoin(users, eq(users.id, teamMembers.userId))
      .where(and(
        eq(teamMembers.teamId, id),
        eq(teamMembers.tenantId, ctx.tenantId),
        isNull(teamMembers.deletedAt),
      ));

    return NextResponse.json({ data: { ...team, members } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

// PATCH /api/tenant/teams/:id — update team fields (admin only).
export const PATCH = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const id = (await params).id;

    const body = await req.json();

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body?.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, teams, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.userId };
    if (typeof body?.name === 'string' && body.name.trim()) updates['name'] = body.name.trim();
    if (body?.description !== undefined) updates['description'] = body.description;
    if (body?.managerId !== undefined) updates['managerId'] = body.managerId || null;
    if (body?.isActive !== undefined) updates['isActive'] = !!body.isActive;

    const [updated] = await db.update(teams)
      .set(updates)
      .where(and(eq(teams.id, id), eq(teams.tenantId, ctx.tenantId), isNull(teams.deletedAt)))
      .returning();
    if (!updated) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    return NextResponse.json({ data: updated });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

// DELETE /api/tenant/teams/:id — soft-delete the team (admin only). Members are
// left in place; the ON DELETE SET NULL FKs mean leads/contacts keep working.
export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'teams', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const id = (await params).id;

    const [deleted] = await db.update(teams)
      .set({ isActive: false, deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(teams.id, id), eq(teams.tenantId, ctx.tenantId), isNull(teams.deletedAt)))
      .returning();
    if (!deleted) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    return NextResponse.json({ data: { id, deleted: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

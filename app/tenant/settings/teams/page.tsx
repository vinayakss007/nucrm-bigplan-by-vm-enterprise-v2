/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { teams, teamMembers, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import TeamsClient from '@/components/tenant/settings/teams-client';
import { withTenantScope } from '@/lib/api/with-api-route';

// Manage sub-teams (Sales, Marketing, Support) — distinct from settings/team,
// which manages the whole workforce and invitations. See docs/workflow-gaps.md
// WF-04.
export default async function TeamsPage() {
  return withTenantScope(async () => {
  let ctx;
  try {
    ctx = await requireTenantCtx();
  } catch {
    redirect('/auth/login');
  }
  if (!ctx) redirect('/auth/login');
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  const [teamRows, memberRows, workforce] = await Promise.all([
    db.select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      managerId: teams.managerId,
      isActive: teams.isActive,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM team_members tm
        WHERE tm.team_id = ${teams.id} AND tm.deleted_at IS NULL
      )`,
    })
      .from(teams)
      .where(and(eq(teams.tenantId, ctx.tenantId), isNull(teams.deletedAt)))
      .orderBy(asc(teams.name)),

    db.select({
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      role: teamMembers.role,
      name: users.fullName,
      email: users.email,
    })
      .from(teamMembers)
      .leftJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.tenantId, ctx.tenantId), isNull(teamMembers.deletedAt))),

    db.select({
      userId: tenantMembers.userId,
      name: users.fullName,
      email: users.email,
    })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.status, 'active')))
      .orderBy(asc(users.fullName)),
  ]);

  const initialTeams = teamRows.map((t) => ({
    ...t,
    description: t.description ?? undefined,
    managerId: t.managerId ?? undefined,
    members: memberRows
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ userId: m.userId, role: m.role, name: m.name ?? m.email ?? m.userId })),
  }));

  const people = workforce.map((w) => ({
    userId: w.userId,
    name: w.name ?? w.email ?? w.userId,
  }));

  return <TeamsClient initialTeams={initialTeams} people={people} />;

  });
}

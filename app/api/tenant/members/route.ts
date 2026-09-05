/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { inviteMemberSchema, updateMemberSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db, type DbClient } from '@/drizzle/db';
import { 
  tenantMembers, users, roles, invitations, 
  contacts, deals, tasks, userDepartures, 
  tenants, leadAssignments 
} from '@/drizzle/schema';
import { eq, and, or, sql, desc, asc, isNull, type SQL } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/session';
import { concurrencyGuard, checkStaleUpdate } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { deleteUserSessions } from '@/lib/cache/sessions';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rawBody = await readJsonBody(request);
    const validated = validateBody(inviteMemberSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    // NOTE: take values from the VALIDATED payload, never rawBody —
    // password/full_name/role_slug previously bypassed Zod entirely.
    const { email, password, full_name, role_slug = 'sales_rep' } = validated.data;

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'email, password, and full_name are required' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();

    const result = await db.transaction(async (tx) => {
      // Check if user already exists
      let [user] = await tx.select()
        .from(users)
        .where(eq(users.email, emailLower))
        .limit(1);
      
      if (!user) {
        // Create user
        const passwordHash = await hashPassword(password);
        [user] = await tx.insert(users)
          .values({
            email: emailLower,
            passwordHash,
            fullName: full_name.trim(),
            emailVerified: true,
          })
          .returning();
      }

      // Check if already a member of this tenant
      const [existingMember] = await tx.select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, user!.id)))
        .limit(1);

      if (existingMember) {
        throw new Error('This user is already a member of this workspace');
      }

      // Resolve role_id
      const [role] = await tx.select()
        .from(roles)
        .where(and(or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId)), eq(roles.slug, role_slug)))
        .limit(1);
      
      const roleId = role?.id || null;

      // Add as tenant member
      const [member] = await tx.insert(tenantMembers)
        .values({
          tenantId: ctx.tenantId,
          userId: user!.id,
          roleSlug: role_slug,
          roleId: roleId,
          status: 'active',
          joinedAt: new Date(),
        })
        .returning();

      // Update tenant user count
      const [userCountResult] = await tx.select({
        count: sql<number>`count(*)::int`
      })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.status, 'active')));

      await tx.update(tenants)
        .set({ currentUsers: userCountResult?.count || 0 })
        .where(eq(tenants.id, ctx.tenantId));

      return { user, member };
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'member_created',
      entityType: 'member',
      entityId: result.user!.id,
      newData: { email: emailLower, role: role_slug }
    });

    return NextResponse.json({ ok: true, data: result }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'members POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const [members, invites] = await Promise.all([
      db.select({
        id: tenantMembers.id,
        userId: tenantMembers.userId,
        roleSlug: tenantMembers.roleSlug,
        status: tenantMembers.status,
        joinedAt: tenantMembers.joinedAt,
        fullName: users.fullName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
        roleName: roles.name,
        permissions: roles.permissions,
        contactCount: sql<number>`(SELECT count(*)::int FROM contacts WHERE assigned_to = ${tenantMembers.userId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL)`,
        dealCount: sql<number>`(SELECT count(*)::int FROM deals WHERE assigned_to = ${tenantMembers.userId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL)`,
        taskCount: sql<number>`(SELECT count(*)::int FROM tasks WHERE assigned_to = ${tenantMembers.userId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL AND status = 'pending')`
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .leftJoin(roles, eq(roles.id, tenantMembers.roleId))
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.status, 'active')))
      .orderBy(asc(tenantMembers.joinedAt)),
      
      db.select()
      .from(invitations)
      .where(and(
        eq(invitations.tenantId, ctx.tenantId),
        isNull(invitations.acceptedAt),
        sql`expires_at > now()`
      ))
      .orderBy(desc(invitations.createdAt)),
    ]);

    return NextResponse.json({ data: members, invitations: invites, tenantId: ctx.tenantId });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'members GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rawPatch = await readJsonBody(request);
    const patchValidated = validateBody(updateMemberSchema, rawPatch);
    if (patchValidated instanceof NextResponse) return patchValidated;
    const pv = patchValidated.data;
    const { email: _email, role_slug: roleSlug } = pv;
    const { memberId, action, reassignTo, reason } = rawPatch;
    if (!memberId || !action) return NextResponse.json({ error: 'memberId and action required' }, { status: 400 });

    const [target] = await db.select({
      userId: tenantMembers.userId,
      roleSlug: tenantMembers.roleSlug,
      fullName: users.fullName,
      email: users.email,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, ctx.tenantId)))
    .limit(1);

    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    if (target.roleSlug === 'admin' && !ctx.isSuperAdmin) return NextResponse.json({ error: 'Cannot modify another admin' }, { status: 403 });
    if (target.userId === ctx.userId && action === 'remove') return NextResponse.json({ error: 'Cannot remove yourself — transfer ownership first' }, { status: 400 });

    if (action === 'change_role') {
      if (!roleSlug) return NextResponse.json({ error: 'roleSlug required' }, { status: 400 });
      const [role] = await db.select()
        .from(roles)
        .where(and(or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId)), eq(roles.slug, roleSlug)))
        .limit(1);
      
      const concurrencyWhere = concurrencyGuard(tenantMembers, rawPatch.expectedUpdatedAt);
      const whereConditions: SQL[] = [eq(tenantMembers.id, memberId)];
      if (concurrencyWhere) whereConditions.push(concurrencyWhere);

      await db.transaction(async (tx) => {
        const [updated] = await tx.update(tenantMembers)
          .set({ roleSlug, roleId: role?.id || null })
          .where(and(...whereConditions))
          .returning();

        const stale = checkStaleUpdate(updated);
        if (stale) return stale;
          
        await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'role_change', entityType: 'member', entityId: target.userId, newData: { role: roleSlug }, dbOrTx: tx as DbClient });
      });

      // Invalidate session cache so the role/permission change takes effect immediately
      // (the middleware re-checks DB on cache miss, but this forces it)
      await deleteUserSessions(target.userId);

    } else if (action === 'remove') {
      const reassignUserId = reassignTo || ctx.userId;

      const [[cCount], [dCount], [tCount]] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(and(eq(contacts.assignedTo, target.userId), eq(contacts.tenantId, ctx.tenantId), isNull(contacts.deletedAt))),
        db.select({ n: sql<number>`count(*)::int` }).from(deals).where(and(eq(deals.assignedTo, target.userId), eq(deals.tenantId, ctx.tenantId), isNull(deals.deletedAt))),
        db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.assignedTo, target.userId), eq(tasks.tenantId, ctx.tenantId), isNull(tasks.deletedAt), eq(tasks.status, 'pending'))),
      ]);

      await db.transaction(async (tx) => {
        // Reassign data
        await tx.update(contacts).set({ assignedTo: reassignUserId, lastAssignedAt: new Date() }).where(and(eq(contacts.assignedTo, target.userId), eq(contacts.tenantId, ctx.tenantId), isNull(contacts.deletedAt)));
        await tx.update(deals).set({ assignedTo: reassignUserId }).where(and(eq(deals.assignedTo, target.userId), eq(deals.tenantId, ctx.tenantId), isNull(deals.deletedAt)));
        await tx.update(tasks).set({ assignedTo: reassignUserId }).where(and(eq(tasks.assignedTo, target.userId), eq(tasks.tenantId, ctx.tenantId), isNull(tasks.deletedAt), eq(tasks.status, 'pending')));

        // Mark member as removed
        await tx.update(tenantMembers).set({ status: 'removed' }).where(eq(tenantMembers.id, memberId));

        // Log departure
        await tx.insert(userDepartures).values({
          tenantId: ctx.tenantId,
          userId: target.userId,
          userEmail: target.email,
          userName: target.fullName,
          departedBy: ctx.userId,
          reason: reason || null,
          contactsReassignedTo: reassignUserId,
          contactsCount: cCount?.n || 0,
          dealsCount: dCount?.n || 0,
          tasksCount: tCount?.n || 0,
        });

        // Update user count
        const [userCountResult] = await tx.select({
          count: sql<number>`count(*)::int`
        })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.status, 'active')));

        await tx.update(tenants)
          .set({ currentUsers: userCountResult?.count || 0 })
          .where(eq(tenants.id, ctx.tenantId));
      });

      // Notify
      if (reassignTo && reassignTo !== ctx.userId) {
        await createNotification({
          userId: reassignTo, tenantId: ctx.tenantId, type: 'system',
          title: `${cCount?.n || 0} contacts and ${dCount?.n || 0} deals reassigned to you`,
          body: `From ${target.fullName || target.email} who left the workspace`,
          link: '/tenant/contacts',
        });
      }
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'member_removed', entityType: 'member', entityId: target.userId, newData: { reassigned_to: reassignTo, contacts: cCount?.n, deals: dCount?.n } });

      // Invalidate removed member's sessions
      await deleteUserSessions(target.userId);

    } else if (action === 'suspend') {
      const concurrencyWhere = concurrencyGuard(tenantMembers, rawPatch.expectedUpdatedAt);
      const whereConditions: SQL[] = [eq(tenantMembers.id, memberId)];
      if (concurrencyWhere) whereConditions.push(concurrencyWhere);

      const [updated] = await db.update(tenantMembers).set({ status: 'suspended' }).where(and(...whereConditions)).returning();

      const stale = checkStaleUpdate(updated);
      if (stale) return stale;

      // Invalidate suspended member's sessions
      await deleteUserSessions(target.userId);
    } else if (action === 'reactivate') {
      const concurrencyWhere = concurrencyGuard(tenantMembers, rawPatch.expectedUpdatedAt);
      const whereConditions: SQL[] = [eq(tenantMembers.id, memberId)];
      if (concurrencyWhere) whereConditions.push(concurrencyWhere);

      const [updated] = await db.update(tenantMembers).set({ status: 'active' }).where(and(...whereConditions)).returning();

      const stale = checkStaleUpdate(updated);
      if (stale) return stale;
    } else if (action === 'assign_lead') {
      let _parsedBody: { contactId?: string };
      try { _parsedBody = await readJsonBody(request); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
      const { contactId } = _parsedBody;
      if (contactId) {
        await db.transaction(async (tx) => {
          await tx.update(contacts).set({ assignedTo: target.userId, lastAssignedAt: new Date() }).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, ctx.tenantId)));
          await tx.insert(leadAssignments).values({
            tenantId: ctx.tenantId,
            contactId: contactId,
            userId: target.userId,
          });
        });
      }
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'members PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { inviteMemberSchema, updateMemberSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { 
  tenantMembers, users, roles, invitations, 
  contacts, deals, tasks, userDepartures, 
  tenants, leadAssignments, activities 
} from '@/drizzle/schema';
import { eq, and, or, sql, desc, asc, isNull } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(inviteMemberSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { email, password, full_name, role_slug = 'sales_rep' } = rawBody;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[members POST]', err);
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[members GET]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rawPatch = await request.json();
    const patchValidated = validateBody(updateMemberSchema, rawPatch);
    if (patchValidated instanceof NextResponse) return patchValidated;
    const pv = patchValidated.data;
    const { email, role_slug: roleSlug } = pv;
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
      
      await db.update(tenantMembers)
        .set({ roleSlug, roleId: role?.id || null })
        .where(eq(tenantMembers.id, memberId));
        
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'role_change', entityType: 'member', entityId: target.userId, newData: { role: roleSlug } });

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

    } else if (action === 'suspend') {
      await db.update(tenantMembers).set({ status: 'suspended' }).where(eq(tenantMembers.id, memberId));
    } else if (action === 'reactivate') {
      await db.update(tenantMembers).set({ status: 'active' }).where(eq(tenantMembers.id, memberId));
    } else if (action === 'assign_lead') {
      let _parsedBody: { contactId?: string };
      try { _parsedBody = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
      const { contactId } = _parsedBody;
      if (contactId) {
        await db.update(contacts).set({ assignedTo: target.userId, lastAssignedAt: new Date() }).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, ctx.tenantId)));
        await db.insert(leadAssignments).values({
          tenantId: ctx.tenantId,
          contactId: contactId,
          userId: target.userId,
        });
      }
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[members PATCH]', err);
    return apiError(err);
  }
}

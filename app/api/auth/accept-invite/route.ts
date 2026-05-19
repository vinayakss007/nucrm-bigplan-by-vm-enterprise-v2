import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { invitations, tenants, users, roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    // Get current user from session
    const cookieStore = await cookies();
    const token = cookieStore.get('nucrm_session')?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { token: inviteToken } = await request.json();
    if (!inviteToken) return NextResponse.json({ error: 'Invitation token required' }, { status: 400 });

    const inv = await db
      .select({
        id: invitations.id,
        tenantId: invitations.tenantId,
        email: invitations.email,
        roleSlug: invitations.roleSlug,
        invitedBy: invitations.invitedBy,
        tenantName: tenants.name,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(and(
        eq(invitations.token, inviteToken),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date())
      ))
      .then(res => res[0]);

    if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 });

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: { email: true }
    });

    if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) {
      return NextResponse.json({ error: 'This invitation is for a different email address' }, { status: 403 });
    }

    await db.transaction(async (tx) => {
      // Find role
      const role = await tx.query.roles.findFirst({
        where: and(
          eq(roles.tenantId, inv.tenantId),
          eq(roles.slug, inv.roleSlug)
        ),
        columns: { id: true }
      });

      // Upsert tenant member
      await tx.insert(tenantMembers)
        .values({
          tenantId: inv.tenantId,
          userId: payload.userId,
          roleSlug: inv.roleSlug,
          roleId: role?.id || null,
          status: 'active',
          invitedBy: inv.invitedBy,
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tenantMembers.tenantId, tenantMembers.userId],
          set: {
            roleSlug: inv.roleSlug,
            roleId: role?.id || null,
            status: 'active',
            joinedAt: new Date(),
          }
        });

      // Mark invitation as accepted
      await tx.update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, inv.id));

      // Update user's last tenant
      await tx.update(users)
        .set({ lastTenantId: inv.tenantId })
        .where(eq(users.id, payload.userId));

      // Update tenant user count
      const memberCount = await tx
        .select({ count: sql`count(*)` })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, inv.tenantId),
          eq(tenantMembers.status, 'active')
        ))
        .then(res => Number(res[0]?.count || 0));

      await tx.update(tenants)
        .set({ currentUsers: memberCount })
        .where(eq(tenants.id, inv.tenantId));
    });

    return NextResponse.json({ ok: true, tenant_name: inv.tenantName });
  } catch (err: any) {
    console.error('[accept-invite]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

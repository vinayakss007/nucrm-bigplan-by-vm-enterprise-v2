import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { SUPER_ADMIN_ROLES } from '@/lib/permissions/super-admin-permissions';

/**
 * GET /api/superadmin/access-control
 * Returns all super admin users with their roles.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        super_admin_role: users.superAdminRole,
      })
      .from(users)
      .where(eq(users.isSuperAdmin, true));

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[superadmin/access-control GET]', err);
    return apiError(err);
  }
}

/**
 * PATCH /api/superadmin/access-control
 * Updates a super admin user's role.
 * Only users with 'super_admin_full' role can change other admins' roles.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check that the requesting user has full access
    const [requestingUser] = await db
      .select({ superAdminRole: users.superAdminRole })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    const requestorRole = requestingUser?.superAdminRole || 'super_admin_full';
    if (requestorRole !== 'super_admin_full') {
      return NextResponse.json({
        error: 'Only users with Full Access role can modify admin roles'
      }, { status: 403 });
    }

    const { userId, role } = await request.json();
    if (!userId || !role) {
      return NextResponse.json({ error: 'userId and role are required' }, { status: 400 });
    }

    if (!SUPER_ADMIN_ROLES[role]) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    // Verify target user is a super admin
    const [targetUser] = await db
      .select({ id: users.id, isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!targetUser.isSuperAdmin) {
      return NextResponse.json({ error: 'Target user is not a super admin' }, { status: 400 });
    }

    const [updated] = await db
      .update(users)
      .set({ superAdminRole: role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        full_name: users.fullName,
        super_admin_role: users.superAdminRole,
      });

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[superadmin/access-control PATCH]', err);
    return apiError(err);
  }
}

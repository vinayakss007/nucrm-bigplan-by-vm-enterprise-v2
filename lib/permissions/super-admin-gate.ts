/**
 * Super Admin Permission Gate
 * ───────────────────────────
 * Enforces granular permissions for super admin users based on their role.
 */

import { NextResponse } from 'next/server';
import { AuthContext } from '@/lib/auth/middleware';
import { SUPER_ADMIN_ROLES } from './super-admin-permissions';

/**
 * Check if a super admin user has the specified permission.
 * Returns null if permission is granted, or a 403 NextResponse if denied.
 *
 * @param ctx - The authenticated user context
 * @param permission - The permission string to check (e.g., 'tenants.delete')
 * @returns null if allowed, NextResponse with 403 if denied
 */
export function requireSuperAdminPerm(
  ctx: AuthContext,
  permission: string
): NextResponse | null {
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Super admin access required' },
      { status: 403 }
    );
  }

  // Get the user's super admin role - default to full access for backward compat
  const roleSlug = ctx.superAdminRole || 'super_admin_full';
  const role = SUPER_ADMIN_ROLES[roleSlug];

  if (!role) {
    // Unknown role - deny by default
    return NextResponse.json(
      { error: `Unknown super admin role: ${roleSlug}` },
      { status: 403 }
    );
  }

  if (role.permissions[permission] === true) {
    return null; // Permission granted
  }

  return NextResponse.json(
    { error: `Permission denied: ${permission} is not granted to role '${role.label}'` },
    { status: 403 }
  );
}

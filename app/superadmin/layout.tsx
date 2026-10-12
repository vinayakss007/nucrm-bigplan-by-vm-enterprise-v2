/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { withUserContext, withSecurityContext } from '@/lib/db/rls';
import { users, tenants } from '@/drizzle/schema';
import { eq, sql, count } from 'drizzle-orm';
import SuperAdminShell from '@/components/superadmin/shell';
import { logError } from '@/lib/errors-server';

/** Header platform stats — mirrors the ShellStats prop consumed by SuperAdminShell. */
interface PlatformStats {
  total_tenants: number;
  active_tenants: number;
  open_errors: number;
}

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  // RLS on `users` is fail-closed: with no context this select returns zero
  // rows and a genuine super admin is bounced to /tenant/dashboard. Under
  // PgBouncer session pooling the GUC left by middleware can mask that on a
  // reused connection, so the bounce looks intermittent. Scope the read to the
  // verified JWT identity instead.
  const [user] = await withUserContext(payload.userId, async (tx) => await tx.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    isSuperAdmin: users.isSuperAdmin,
  })
  .from(users)
  .where(eq(users.id, payload.userId))
  .limit(1));

  if (!user?.isSuperAdmin) redirect('/tenant/dashboard');

  // Map to snake_case for components that expect it
  const userData = {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    is_super_admin: user.isSuperAdmin,
  };

  // Quick platform stats for header — platform-wide, so it needs the
  // super-admin context rather than a tenant scope.
  const [stats] = await withSecurityContext(async (tx) => await tx.select({
    total_tenants: count(),
    active_tenants: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'active')::int`,
    open_errors: sql<number>`(SELECT count(*)::int FROM error_logs WHERE resolved = false AND level IN ('error','fatal'))`,
  })
  .from(tenants))
  .catch((error): PlatformStats[] => {
    void logError({ error, context: 'superadmin/layout stats query failed' });
    return [{ total_tenants: 0, active_tenants: 0, open_errors: 0 }];
  });

  return (
    <SuperAdminShell user={userData} stats={stats ?? null}>{children}</SuperAdminShell>
  );
}

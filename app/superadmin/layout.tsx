import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { users, tenants, errorLogs } from '@/drizzle/schema';
import { eq, sql, count } from 'drizzle-orm';
import SuperAdminShell from '@/components/superadmin/shell';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  const [user] = await db.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    isSuperAdmin: users.isSuperAdmin,
  })
  .from(users)
  .where(eq(users.id, payload.userId))
  .limit(1);

  if (!user?.isSuperAdmin) redirect('/tenant/dashboard');

  // Map to snake_case for components that expect it
  const userData = {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    is_super_admin: user.isSuperAdmin,
  };

  // Quick platform stats for header
  const [stats] = await db.select({
    total_tenants: count(),
    active_tenants: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'active')::int`,
    open_errors: sql<number>`(SELECT count(*)::int FROM error_logs WHERE resolved = false AND level IN ('error','fatal'))`,
  })
  .from(tenants)
  .catch(() => [{ total_tenants: 0, active_tenants: 0, open_errors: 0 }]);

  return (
    <SuperAdminShell user={userData} stats={stats as any}>{children}</SuperAdminShell>
  );
}

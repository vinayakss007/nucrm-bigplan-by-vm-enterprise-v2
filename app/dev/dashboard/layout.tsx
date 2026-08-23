/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Server-side guard for the development dashboard (Issue #1327).
 * Only authenticated super admins may load this page tree; everyone
 * else is redirected home before any client code runs.
 */
export default async function DevDashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/');
  const payload = await verifyToken(token);
  if (!payload) redirect('/');

  const [user] = await db.select({
    isSuperAdmin: users.isSuperAdmin,
  })
  .from(users)
  .where(eq(users.id, payload.userId))
  .limit(1);

  if (!user?.isSuperAdmin) redirect('/');

  return <>{children}</>;
}

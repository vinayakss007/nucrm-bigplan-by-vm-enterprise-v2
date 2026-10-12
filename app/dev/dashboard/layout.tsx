/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUserForToken } from '@/lib/auth/session';

/**
 * Server-side guard for the development dashboard (Issue #1327).
 * Only authenticated super admins may load this page tree; everyone
 * else is redirected home before any client code runs.
 *
 * #2216: the check is session-backed — a JWT whose session row was removed
 * (logout / admin revocation) no longer unlocks the dev tools.
 * getCurrentUserForToken already resolves isSuperAdmin from the joined user
 * row, replacing the previous RLS-blind second query.
 */
export default async function DevDashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/');
  const user = await getCurrentUserForToken(token);
  if (!user?.isSuperAdmin) redirect('/');

  return <>{children}</>;
}

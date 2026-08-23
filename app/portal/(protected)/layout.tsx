/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/portal-session';

/**
 * Server-side auth guard for every customer-portal page (Issue #1326).
 *
 * Validates the nucrm_portal_session cookie against the portal_clients
 * table; visitors without a valid session are redirected to the login
 * page before any client component or data fetch runs.
 */
export default async function ProtectedPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  return <>{children}</>;
}

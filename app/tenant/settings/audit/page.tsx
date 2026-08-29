/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import AuditLogClient from '@/components/tenant/settings/audit-client';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function AuditLogPage() {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  return <AuditLogClient />;

  });
}

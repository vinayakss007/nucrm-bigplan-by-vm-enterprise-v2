/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import DashboardClient from '@/components/tenant/dashboard-client';
import { withTenantScope } from '@/lib/api/with-api-route';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();

  // Onboarding wizard removed: signup already creates the workspace,
  // pipeline, and default modules, so new users land straight here.
  return (
    <DashboardClient
      tenantId={ctx.tenantId}
      userId={ctx.userId}
      planName={ctx.plan.name}
      isAdmin={ctx.isAdmin}
    />
  );

  });
}

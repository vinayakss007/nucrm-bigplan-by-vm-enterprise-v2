/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import { hasCompletedOnboarding } from '@/lib/onboarding/check';
import DashboardClient from '@/components/tenant/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const ctx = await requireTenantCtx();

  // Redirect first-time users to onboarding
  const onboarded = await hasCompletedOnboarding(ctx.tenantId, ctx.userId);
  if (!onboarded) {
    redirect('/tenant/onboarding');
  }

  return (
    <DashboardClient
      tenantId={ctx.tenantId}
      userId={ctx.userId}
      planName={ctx.plan.name}
      isAdmin={ctx.isAdmin}
    />
  );
}

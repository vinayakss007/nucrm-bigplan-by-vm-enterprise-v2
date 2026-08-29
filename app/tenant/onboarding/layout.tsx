/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import { hasCompletedOnboarding } from '@/lib/onboarding/check';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return withTenantScope(async () => {
  try {
    const ctx = await requireTenantCtx();
    const completed = await hasCompletedOnboarding(ctx.tenantId, ctx.userId);
    if (completed) {
      redirect('/tenant/dashboard');
    }
  } catch {
    // If tenant context or DB check fails, redirect to dashboard (fail-safe)
    redirect('/tenant/dashboard');
  }
  return <>{children}</>;

  });
}

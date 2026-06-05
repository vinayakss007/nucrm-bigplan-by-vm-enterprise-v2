import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import { hasCompletedOnboarding } from '@/lib/onboarding/check';
import DashboardClient from '@/components/tenant/dashboard-client';

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

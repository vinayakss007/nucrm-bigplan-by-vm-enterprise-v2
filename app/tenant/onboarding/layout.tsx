import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import { hasCompletedOnboarding } from '@/lib/onboarding/check';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
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
}

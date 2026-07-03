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
    // If tenant context fails, let the page handle it
  }
  return <>{children}</>;
}

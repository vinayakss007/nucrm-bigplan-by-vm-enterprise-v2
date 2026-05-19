import { requireTenantCtx } from '@/lib/tenant/context';
import DashboardClient from '@/components/tenant/dashboard-client';

export default async function DashboardPage() {
  const ctx = await requireTenantCtx();
  return (
    <DashboardClient
      tenantId={ctx.tenantId}
      userId={ctx.userId}
      planName={ctx.plan.name}
      isAdmin={ctx.isAdmin}
    />
  );
}

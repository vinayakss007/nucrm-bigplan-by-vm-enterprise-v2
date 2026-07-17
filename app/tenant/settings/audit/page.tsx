import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import AuditLogClient from '@/components/tenant/settings/audit-client';

export default async function AuditLogPage() {
  const ctx = await requireTenantCtx();
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  return <AuditLogClient />;
}

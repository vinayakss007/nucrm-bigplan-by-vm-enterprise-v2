import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';

export default async function WebhooksPage() {
  await requireTenantCtx();
  redirect('/tenant/settings/integrations');
}

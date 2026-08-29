/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function WebhooksPage() {
  return withTenantScope(async () => {
  await requireTenantCtx();
  redirect('/tenant/settings/integrations');

  });
}

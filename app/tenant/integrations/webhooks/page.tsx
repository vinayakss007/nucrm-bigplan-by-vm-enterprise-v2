/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { redirect } from 'next/navigation';

export default async function WebhooksPage() {
  await requireTenantCtx();
  redirect('/tenant/settings/integrations');
}

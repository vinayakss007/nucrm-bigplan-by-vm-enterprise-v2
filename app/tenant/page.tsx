/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { redirect } from 'next/navigation';

export default function TenantIndexPage() {
  redirect('/tenant/dashboard');
}

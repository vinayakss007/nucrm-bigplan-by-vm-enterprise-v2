/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SuperadminTenantsIdRolesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="superadmin tenants [id] roles error" tone="dark" />;
}

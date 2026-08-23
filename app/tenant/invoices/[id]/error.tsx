/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function InvoiceDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="invoice detail"
      title="Unable to load invoice"
      description="We couldn't load this invoice. Please try again or contact support."
    />
  );
}

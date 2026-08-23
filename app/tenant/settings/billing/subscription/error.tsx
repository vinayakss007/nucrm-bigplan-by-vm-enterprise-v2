/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SubscriptionError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="settings billing subscription"
      title="Subscription details unavailable"
      description="An error occurred while loading subscription information. Please try again."
    />
  );
}

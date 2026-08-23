/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ForgotPasswordError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="forgot-password error"
      title="Unable to load password reset"
      description="Something went wrong. Please try again."
      fullScreen
    >
      <p className="mt-4 text-sm">
        <a href="/auth/forgot-password" className="text-violet-600 hover:underline">
          Try again
        </a>
      </p>
    </ErrorFallback>
  );
}

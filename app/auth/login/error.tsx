/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function LoginError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="login error"
      title="Unable to load login"
      description="Something went wrong loading the login page. Please try again."
      fullScreen
    >
      <p className="mt-4 text-sm">
        <a href="/auth/login" className="text-violet-600 hover:underline">
          Retry sign in
        </a>
      </p>
    </ErrorFallback>
  );
}

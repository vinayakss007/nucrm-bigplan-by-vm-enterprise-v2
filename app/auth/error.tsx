/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

/**
 * Auth pages previously fell through to the root boundary, whose "Dashboard"
 * recovery link is useless to someone who cannot sign in. This one keeps the user
 * on the auth flow.
 */
export default function AuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="auth error"
      title="We could not complete that"
      description="Something went wrong during sign-in. Your credentials were not affected."
      fullScreen
    >
      <p className="mt-4 text-sm">
        <a href="/auth/login" className="text-violet-600 hover:underline">
          Back to sign in
        </a>
      </p>
    </ErrorFallback>
  );
}

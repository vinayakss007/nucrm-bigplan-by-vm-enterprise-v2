'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function CallbackError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="auth callback error"
      title="Sign-in callback failed"
      description="We could not complete the sign-in process. Please try again."
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

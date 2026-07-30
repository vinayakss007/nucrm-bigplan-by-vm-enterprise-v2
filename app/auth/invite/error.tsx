'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function InviteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="invite error"
      title="Invitation failed"
      description="Something went wrong loading the invitation. Please try again."
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

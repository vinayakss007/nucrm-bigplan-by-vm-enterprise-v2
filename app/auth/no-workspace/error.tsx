'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function NoWorkspaceError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="no-workspace error"
      title="Something went wrong"
      description="We could not load this page. Please try again."
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

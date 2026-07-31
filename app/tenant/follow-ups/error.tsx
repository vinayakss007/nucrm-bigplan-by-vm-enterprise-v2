'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function FollowUpsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="follow-ups"
      title="Follow-ups unavailable"
      description="An error occurred while loading your follow-ups. Please try again."
    />
  );
}

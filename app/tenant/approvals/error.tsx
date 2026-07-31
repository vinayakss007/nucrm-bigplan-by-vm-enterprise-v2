'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ApprovalsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="approvals"
      title="Approvals unavailable"
      description="An error occurred while loading approvals. Please try again."
    />
  );
}

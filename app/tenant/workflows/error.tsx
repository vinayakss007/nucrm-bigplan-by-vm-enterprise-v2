'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function WorkflowsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="workflows"
      title="Workflows unavailable"
      description="An error occurred while loading workflows. Please try again."
    />
  );
}

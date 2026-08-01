'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function DataExplorerError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="data explorer"
      title="Data explorer unavailable"
      description="An error occurred while loading the data explorer. Please try again."
    />
  );
}

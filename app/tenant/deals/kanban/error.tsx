'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function DealKanbanError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="deal kanban"
      title="Pipeline view unavailable"
      description="An error occurred while loading the pipeline board. Please try again."
    />
  );
}

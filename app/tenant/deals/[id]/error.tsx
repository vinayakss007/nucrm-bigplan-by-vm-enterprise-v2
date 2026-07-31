'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function DealDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="deal detail"
      title="Unable to load deal"
      description="We couldn't load this deal's details. It may have been moved or deleted."
    />
  );
}

'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function OffersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="offers"
      title="Offers unavailable"
      description="An error occurred while loading offers. Please try again."
    />
  );
}

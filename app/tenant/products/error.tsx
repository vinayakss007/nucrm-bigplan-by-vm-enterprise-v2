'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ProductsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="products"
      title="Products unavailable"
      description="An error occurred while loading the product catalog. Please try again."
    />
  );
}

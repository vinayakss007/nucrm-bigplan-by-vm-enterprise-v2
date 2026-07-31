'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function LeadDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="lead detail"
      title="Unable to load lead"
      description="We couldn't load this lead's details. It may have been converted or removed."
    />
  );
}

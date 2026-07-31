'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function TicketDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="ticket detail"
      title="Unable to load ticket"
      description="We couldn't load this support ticket. It may have been closed or removed."
    />
  );
}

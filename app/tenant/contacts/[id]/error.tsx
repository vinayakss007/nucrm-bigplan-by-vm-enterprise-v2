'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ContactDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="contact detail"
      title="Unable to load contact"
      description="We couldn't load this contact's details. Please try again."
    />
  );
}

'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

/**
 * The customer portal is used by external contacts, not staff. The root
 * boundary's link into /tenant/dashboard would send them somewhere they have no
 * access to, so the portal needs its own.
 */
export default function PortalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="portal error"
      description="Something went wrong loading this page. Please try again, or contact your account manager if it persists."
      fullScreen
    />
  );
}

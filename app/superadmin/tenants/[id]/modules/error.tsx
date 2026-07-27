'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SuperadminTenantsIdModulesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="superadmin tenants [id] modules error" tone="dark" />;
}

'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ProfileError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="settings-profile error" />;
}

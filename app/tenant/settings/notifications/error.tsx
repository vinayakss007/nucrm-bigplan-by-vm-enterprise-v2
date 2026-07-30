'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function NotificationsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} context="settings-notifications error" />;
}

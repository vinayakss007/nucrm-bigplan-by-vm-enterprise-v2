'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function KbArticleError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="knowledge base article"
      title="Article unavailable"
      description="We couldn't load this knowledge base article. Please try again."
    />
  );
}

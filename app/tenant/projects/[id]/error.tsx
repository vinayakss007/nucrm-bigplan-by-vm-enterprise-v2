'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function ProjectDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="project detail"
      title="Unable to load project"
      description="We couldn't load this project's details. Please try again."
    />
  );
}

'use client';

import { ErrorFallback } from '@/components/shared/error-fallback';

export default function SignupError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      {...props}
      context="signup error"
      title="Unable to load signup"
      description="Something went wrong loading the signup page. Please try again."
      fullScreen
    >
      <p className="mt-4 text-sm">
        <a href="/auth/signup" className="text-violet-600 hover:underline">
          Retry sign up
        </a>
      </p>
    </ErrorFallback>
  );
}

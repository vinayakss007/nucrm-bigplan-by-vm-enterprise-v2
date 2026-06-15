'use client';

import { useEffect, useRef } from 'react';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sentryPromise: Promise<any> | null = null;

function getSentry() {
  if (!sentryPromise) {
    sentryPromise = import('@sentry/nextjs').catch(() => null);
  }
  return sentryPromise;
}

export function captureError(error: unknown, context?: string) {
  console.error(context ? `[${context}]` : '[error]', error);
  getSentry().then((Sentry) => {
    if (Sentry) Sentry.captureException(error, { tags: { context: context || 'app' } });
  });
}


export function useCaptureError(error: Error | null, context?: string) {
  const captured = useRef(false);
  useEffect(() => {
    if (!error || captured.current) return;
    captured.current = true;
    captureError(error, context);
  }, [error, context]);
}

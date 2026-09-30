/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useRef } from 'react';

let sentryPromise: Promise<typeof import("@sentry/nextjs") | null> | null = null;

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

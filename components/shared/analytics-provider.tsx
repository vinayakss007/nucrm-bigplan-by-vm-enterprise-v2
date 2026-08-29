/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect } from 'react';
import { initAutoPageViews } from '@/lib/analytics/client';

/**
 * Mounts once at the app root and enables automatic product-analytics
 * page-view tracking, including SPA route changes. Renders nothing.
 *
 * Behavioral tracking only — identity and paid/plan traits are resolved
 * server-side at ingest (POST /api/track/event), never from the client.
 *
 * Tracking can be disabled entirely at build/runtime with
 * NEXT_PUBLIC_ANALYTICS_DISABLED=true (e.g. for previews or self-hosted
 * installs that opt out).
 */
export default function AnalyticsProvider() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ANALYTICS_DISABLED === 'true') return;
    const teardown = initAutoPageViews();
    return teardown;
  }, []);

  return null;
}

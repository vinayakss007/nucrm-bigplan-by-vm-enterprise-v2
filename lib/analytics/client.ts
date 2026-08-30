/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Client-side analytics tracker.
 *
 * Thin wrapper over POST /api/track/event. It sends the event name, optional
 * properties, and page context. It deliberately does NOT send identity or
 * plan — those are resolved server-side from the session cookie. The
 * `nucrm_anon_id` cookie is set by the server on first ingest; this module
 * only reads it (best-effort) to attach a stable per-tab session id.
 *
 * Usage:
 *   import { track, trackPageView, initAutoPageViews } from '@/lib/analytics/client';
 *   track('feature_used', { feature: 'deal.create' });
 */
'use client';

const ENDPOINT = '/api/track/event';

/** Per-tab session id, stitched into every event for funnel analysis. */
let sessionId: string | null = null;

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const KEY = 'nucrm_analytics_session';
    const existing = sessionStorage.getItem(KEY);
    if (existing) {
      sessionId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(KEY, fresh);
    sessionId = fresh;
    return fresh;
  } catch {
    // sessionStorage unavailable (private mode / SSR) — ephemeral id.
    sessionId = sessionId ?? crypto.randomUUID();
    return sessionId;
  }
}

interface TrackPayload {
  event: string;
  properties?: Record<string, unknown>;
  url?: string;
  referrer?: string;
  sessionId?: string;
}

function buildPayload(event: string, properties?: Record<string, unknown>): TrackPayload {
  return {
    event,
    properties,
    url: typeof location !== 'undefined' ? location.pathname + location.search : undefined,
    referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    sessionId: getSessionId(),
  };
}

/**
 * Record an analytics event. Fire-and-forget; never throws, never blocks the
 * UI. Uses fetch with keepalive so in-flight events survive navigation.
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const payload = buildPayload(event, properties);

  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {
      /* analytics must never surface errors */
    });
  } catch {
    /* ignore */
  }
}

/**
 * Send an event via navigator.sendBeacon when available (best for unload /
 * page-hide), falling back to keepalive fetch.
 */
export function trackBeacon(event: string, properties?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const payload = buildPayload(event, properties);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    /* fall through to fetch */
  }
  track(event, properties);
}

/** Convenience: record a page view for the current URL. */
export function trackPageView(properties?: Record<string, unknown>): void {
  track('page_view', {
    title: typeof document !== 'undefined' ? document.title : undefined,
    ...properties,
  });
}

let autoInitialized = false;

/**
 * Enable automatic page-view tracking, including SPA route changes (history
 * pushState/replaceState and popstate). Call once from a top-level client
 * component (e.g. a Providers wrapper). Safe to call more than once.
 */
export function initAutoPageViews(): () => void {
  if (typeof window === 'undefined' || autoInitialized) return () => {};
  autoInitialized = true;

  let lastPath = location.pathname + location.search;

  const fire = () => {
    const current = location.pathname + location.search;
    if (current === lastPath) return;
    lastPath = current;
    trackPageView();
  };

  // Patch history so SPA navigations emit page views.
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function patchedPush(...args: Parameters<History['pushState']>) {
    const r = origPush(...args);
    queueMicrotask(fire);
    return r;
  };
  history.replaceState = function patchedReplace(...args: Parameters<History['replaceState']>) {
    const r = origReplace(...args);
    queueMicrotask(fire);
    return r;
  };
  window.addEventListener('popstate', fire);

  // Initial page view for the first load.
  trackPageView();

  // Teardown (restores patched history methods).
  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', fire);
    autoInitialized = false;
  };
}

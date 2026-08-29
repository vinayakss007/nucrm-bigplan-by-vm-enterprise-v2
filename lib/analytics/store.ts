/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Analytics event store — a thin, swappable seam.
 *
 * The ingest API and client only ever call `recordEvent()`. The concrete
 * storage lives behind this interface so the raw event firehose can later be
 * moved off the primary Postgres (to ClickHouse / PostHog / Timescale) by
 * swapping the implementation — WITHOUT touching the API route or the client.
 *
 * Today: Postgres implementation writing to the isolated `analytics_events`
 * table (drizzle/schema/analytics.ts). Selected via ANALYTICS_STORE env var
 * (default "postgres"). Unknown/`none` values fall back to a no-op store so
 * tracking can be disabled in an environment without breaking callers.
 */
import { db } from '@/drizzle/db';
import { analyticsEvents } from '@/drizzle/schema';

/** A single analytics event, already server-resolved and validated. */
export interface AnalyticsEvent {
  anonId: string;
  eventName: string;
  /** Resolved server-side — never taken from the client. */
  tenantId: string | null;
  userId: string | null;
  isPaid: boolean;
  planId: string | null;
  properties?: Record<string, unknown>;
  url?: string;
  referrer?: string;
  sessionId?: string;
}

export interface AnalyticsStore {
  recordEvent(event: AnalyticsEvent): Promise<void>;
}

/** Postgres-backed store: appends to the isolated analytics_events table. */
class PostgresAnalyticsStore implements AnalyticsStore {
  async recordEvent(event: AnalyticsEvent): Promise<void> {
    await db.insert(analyticsEvents).values({
      anonId: event.anonId,
      eventName: event.eventName,
      tenantId: event.tenantId,
      userId: event.userId,
      isPaid: event.isPaid,
      planId: event.planId,
      properties: event.properties ?? {},
      url: event.url ?? '',
      referrer: event.referrer ?? '',
      sessionId: event.sessionId ?? '',
    });
  }
}

/** No-op store: used when analytics is disabled (ANALYTICS_STORE=none). */
class NoopAnalyticsStore implements AnalyticsStore {
  async recordEvent(): Promise<void> {
    /* intentionally does nothing */
  }
}

let _store: AnalyticsStore | null = null;

function createStore(): AnalyticsStore {
  const backend = (process.env['ANALYTICS_STORE'] ?? 'postgres').toLowerCase();
  switch (backend) {
    case 'none':
    case 'off':
    case 'disabled':
      return new NoopAnalyticsStore();
    case 'postgres':
    case 'pg':
    default:
      // Future backends (clickhouse/posthog) plug in here without changing
      // any caller.
      return new PostgresAnalyticsStore();
  }
}

/** Lazily-instantiated singleton store for the configured backend. */
export function getAnalyticsStore(): AnalyticsStore {
  if (!_store) _store = createStore();
  return _store;
}

/**
 * Record an analytics event. Never throws — analytics must not break the
 * request that triggered it. Errors are logged and swallowed.
 */
export async function recordEvent(event: AnalyticsEvent): Promise<void> {
  try {
    await getAnalyticsStore().recordEvent(event);
  } catch (err) {
    console.error('[analytics] recordEvent failed:', err);
  }
}

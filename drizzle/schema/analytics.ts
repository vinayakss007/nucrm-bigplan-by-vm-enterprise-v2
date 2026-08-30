/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Product Analytics Schema
 *
 * Captures how people use the NuCRM app itself: page views, feature usage,
 * and lifecycle events. This is a deliberately ISOLATED, append-only event
 * stream — it does NOT hold foreign keys to CRM tables (tenant_id / user_id
 * are plain columns, not FK references). That keeps the analytics firehose
 * decoupled from the transactional schema so it can be partitioned, pruned on
 * a short retention window, or migrated wholesale to a dedicated store
 * (ClickHouse / PostHog) later without any FK cascade coupling.
 *
 * Security note: `isPaid` and `planId` are resolved SERVER-SIDE from the
 * authenticated tenant at ingest time (see lib/analytics/entitlement.ts).
 * They are never trusted from the client payload.
 */
import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Plain columns — intentionally NOT FK references (see file header).
  tenantId: uuid('tenant_id'),
  userId: uuid('user_id'),

  // Stable first-party anonymous id from the nucrm_anon_id cookie. Lets us
  // stitch pre-login and post-login behavior for the same browser.
  anonId: text('anon_id').notNull(),

  // e.g. 'page_view', 'feature_used', 'signup', 'login', 'plan_upgraded'
  eventName: text('event_name').notNull(),

  // Arbitrary event-specific properties (feature key, target id, etc.).
  properties: jsonb('properties').default({}).notNull(),

  url: text('url').default(''),
  referrer: text('referrer').default(''),
  // Client-generated per-tab session id for funnel/session stitching.
  sessionId: text('session_id').default(''),

  // Server-resolved entitlement snapshot at event time (never client-trusted).
  isPaid: boolean('is_paid').default(false).notNull(),
  planId: text('plan_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    // Primary reporting access pattern: per-tenant, over a time window.
    tenantTimeIdx: index('idx_analytics_events_tenant_time').on(table.tenantId, table.createdAt),
    // Event-name breakdowns over time.
    eventTimeIdx: index('idx_analytics_events_event_time').on(table.eventName, table.createdAt),
    // Anonymous-visitor stitching lookups.
    anonIdx: index('idx_analytics_events_anon').on(table.anonId),
  };
});

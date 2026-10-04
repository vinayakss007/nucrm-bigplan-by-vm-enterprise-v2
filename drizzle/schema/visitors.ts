/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Visitor Tracking Schema
 * 
 * Tracks anonymous and identified website visitors, their page views,
 * and calculates engagement scores for lead prioritization.
 */
import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { contacts } from './crm';

export const visitors = pgTable('visitors', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  fingerprintId: text('fingerprint_id').notNull(),
  identifiedContactId: uuid('identified_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  totalPageViews: integer('total_page_views').default(0).notNull(),
  score: integer('score').default(0).notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    // #2255 live-DB mirror
    drz2255_idx_visitors_tenant_id: index('idx_visitors_tenant_id').on(table.tenantId),
  };
});

export const pageViews = pgTable('page_views', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  visitorId: uuid('visitor_id').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title').default(''),
  referrer: text('referrer').default(''),
  durationSeconds: integer('duration_seconds').default(0),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    // #2255: live DB created idx_page_views_tenant_id (hand-written migration),
    // not the utils.tenantIdx() name — mirror the live name.
    tenantIdx: index('idx_page_views_tenant_id').on(table.tenantId),
    visitorIdx: index('idx_page_views_visitor').on(table.visitorId),
  };
});

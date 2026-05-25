/**
 * Visitor Tracking Schema
 * 
 * Tracks anonymous and identified website visitors, their page views,
 * and calculates engagement scores for lead prioritization.
 */
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import * as utils from './utils';

export const visitors = pgTable('visitors', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  fingerprintId: text('fingerprint_id').notNull(),
  identifiedContactId: uuid('identified_contact_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  totalPageViews: integer('total_page_views').default(0).notNull(),
  score: integer('score').default(0).notNull(),
  ...utils.lifecycle(),
});

export const pageViews = pgTable('page_views', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  visitorId: uuid('visitor_id').notNull(),
  url: text('url').notNull(),
  title: text('title').default(''),
  referrer: text('referrer').default(''),
  durationSeconds: integer('duration_seconds').default(0),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
});

import { pgTable, uuid, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { tenants, users } from './core';

export const loginAttempts = pgTable('login_attempts', {
  id: utils.pk(),
  email: text('email').notNull(),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent'),
  success: boolean('success').notNull().default(false),
  failureReason: text('failure_reason'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  ...utils.lifecycle(),
}, (table) => ({
  emailIdx: index('idx_login_attempts_email').on(table.email),
  ipIdx: index('idx_login_attempts_ip').on(table.ipAddress),
  timeIdx: index('idx_login_attempts_time').on(table.attemptedAt),
}));

export const loginBlocks = pgTable('login_blocks', {
  id: utils.pk(),
  identifier: text('identifier').notNull(),
  identifierType: text('identifier_type').notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
  blockReason: text('block_reason'),
  attemptsCount: integer('attempts_count').default(0),
  ...utils.lifecycle(),
}, (table) => ({
  identifierTypeUnique: uniqueIndex('idx_login_blocks_identifier_type').on(table.identifier, table.identifierType),
  untilIdx: index('idx_login_blocks_until').on(table.blockedUntil),
}));

export const securityEvents = pgTable('security_events', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: text('metadata'),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: index('idx_security_events_tenant').on(table.tenantId),
  userIdx: index('idx_security_events_user').on(table.userId),
  typeIdx: index('idx_security_events_type').on(table.eventType),
  timeIdx: index('idx_security_events_time').on(table.createdAt),
}));

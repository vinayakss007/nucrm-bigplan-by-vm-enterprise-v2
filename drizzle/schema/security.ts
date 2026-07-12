import { pgTable, uuid, text, timestamp, boolean, integer, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
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

// ── SSO PROVIDERS ─────────────────────────────────────
export const ssoProviders = pgTable('sso_providers', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  providerType: text('provider_type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── SSO SESSIONS ──────────────────────────────────────
export const ssoSessions = pgTable('sso_sessions', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  providerId: uuid('provider_id').references(() => ssoProviders.id, { onDelete: 'set null' }),
  sessionId: text('session_id').notNull(),
  idToken: text('id_token'),
  samlAssertion: text('saml_assertion'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    userIdx: index('idx_sso_sessions_user').on(table.userId, table.createdAt),
    sessionIdx: index('idx_sso_sessions_id').on(table.sessionId),
    tenantIdx: utils.tenantIdx(table),
  };
});

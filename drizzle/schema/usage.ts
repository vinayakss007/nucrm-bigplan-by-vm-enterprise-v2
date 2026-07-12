import { pgTable, uuid, text, timestamp, jsonb, integer, bigint, boolean, date, uniqueIndex, index, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './core';
import * as utils from './utils';

// ── 1. USER USAGE TRACKING ────────────────────────────
export const userUsage = pgTable('user_usage', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  counters: jsonb('counters').default({}),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).default(0),
  apiCallsToday: integer('api_calls_today').default(0),
  apiCallsDate: date('api_calls_date').default(sql`CURRENT_DATE`),
  aiTokensToday: integer('ai_tokens_today').default(0),
  aiTokensDate: date('ai_tokens_date').default(sql`CURRENT_DATE`),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => ({
  uniqueUser: uniqueIndex('idx_user_usage_unique').on(table.tenantId, table.userId),
  tenantIdx: utils.tenantIdx(table),
}));

// ── 2. PLAN LIMITS ────────────────────────────────────
export const planLimits = pgTable('plan_limits', {
  id: utils.pk(),
  planId: text('plan_id').notNull().unique(),
  maxUsers: integer('max_users'),
  maxContacts: integer('max_contacts'),
  maxDeals: integer('max_deals'),
  maxStorageBytes: bigint('max_storage_bytes', { mode: 'number' }),
  maxApiCallsPerDay: integer('max_api_calls_per_day'),
  maxAiTokensPerDay: integer('max_ai_tokens_per_day'),
  maxEmailsPerDay: integer('max_emails_per_day'),
  maxActiveAutomations: integer('max_active_automations'),
  maxTickets: integer('max_tickets'),
  maxForms: integer('max_forms'),
  maxCustomFieldsPerEntity: integer('max_custom_fields_per_entity'),
  maxFileUploadBytes: integer('max_file_upload_bytes'),
  isActive: boolean('is_active').default(true),
  ...utils.lifecycle(),
});

// ── 3. USAGE SNAPSHOTS ────────────────────────────────
export const usageSnapshots = pgTable('usage_snapshots', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  snapshotDate: text('snapshot_date').notNull().default(sql`CURRENT_DATE::text`),
  contactsCount: integer('contacts_count').default(0),
  leadsCount: integer('leads_count').default(0),
  dealsCount: integer('deals_count').default(0),
  usersCount: integer('users_count').default(0),
  storageUsedMb: numeric('storage_used_mb', { precision: 10, scale: 2 }).default('0'),
  apiCallsCount: integer('api_calls_count').default(0),
  emailSentCount: integer('email_sent_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantDateIdx: index('idx_usage_snapshots_tenant_date').on(table.tenantId, table.snapshotDate),
    dateIdx: index('idx_usage_snapshots_date').on(table.snapshotDate),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 4. LIMIT VIOLATIONS ───────────────────────────────
export const limitViolations = pgTable('limit_violations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  violationType: text('violation_type').notNull(),
  limitValue: integer('limit_value'),
  actualValue: integer('actual_value'),
  exceededAt: timestamp('exceeded_at', { withTimezone: true }).defaultNow(),
  notified: boolean('notified').default(false),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    unresolvedIdx: index('idx_limit_violations_unresolved').on(table.resolved, table.exceededAt).where(sql`resolved = false`),
  };
});

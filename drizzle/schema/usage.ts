import { pgTable, uuid, text, timestamp, jsonb, integer, bigint, boolean, date, uniqueIndex } from 'drizzle-orm/pg-core';
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

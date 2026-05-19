import { uniqueIndex, pgTable, uuid, text, timestamp, boolean, integer, bigint, index, decimal } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { tenants, users } from './core';

// ── 1. GLOBAL SERVICE BUDGETS ────────────────────────
export const tokenBudgets = pgTable('token_budgets', {
  id: utils.pk(),
  service: text('service').notNull(),
  monthlyBudgetCents: bigint('monthly_budget_cents', { mode: 'number' }).notNull().default(0),
  currentMonthCents: bigint('current_month_cents', { mode: 'number' }).notNull().default(0),
  alertAt50pct: boolean('alert_at_50pct').default(true),
  alertAt80pct: boolean('alert_at_80pct').default(true),
  alertAt100pct: boolean('alert_at_100pct').default(true),
  hardCapEnabled: boolean('hard_cap_enabled').default(true),
  softCapEnabled: boolean('soft_cap_enabled').default(true),
  billingPeriod: text('billing_period').notNull(), // 'YYYY-MM'
  resetDay: integer('reset_day').default(1),
  ...utils.lifecycle(),
}, (table) => {
  return {
    servicePeriodIdx: uniqueIndex('idx_token_budgets_service_period').on(table.service, table.billingPeriod),
    serviceIdx: index('idx_token_budgets_service').on(table.service, table.billingPeriod),
  };
});

// ── 2. PER-TENANT TOKEN LIMITS ───────────────────────
export const tenantTokenLimits = pgTable('tenant_token_limits', {
  id: utils.pk(),
  tenantId: utils.tenantId().unique(),
  openaiMonthlyLimit: bigint('openai_monthly_limit', { mode: 'number' }).default(-1),
  whatsappMonthlyMsgs: bigint('whatsapp_monthly_msgs', { mode: 'number' }).default(-1),
  voiceMonthlyMins: bigint('voice_monthly_mins', { mode: 'number' }).default(-1),
  contentMonthlyGen: bigint('content_monthly_gen', { mode: 'number' }).default(-1),
  proposalMonthlyGen: bigint('proposal_monthly_gen', { mode: 'number' }).default(-1),
  followupMonthlyCnt: bigint('followup_monthly_cnt', { mode: 'number' }).default(-1),
  scoreMonthlyCnt: bigint('score_monthly_cnt', { mode: 'number' }).default(-1),
  totalMonthlyCost: bigint('total_monthly_cost', { mode: 'number' }).default(-1),
  hardCapAction: text('hard_cap_action').default('block'),
  overrideReason: text('override_reason'),
  setBy: uuid('set_by').references(() => users.id),
  ...utils.lifecycle(),
});

// ── 3. PER-USER TOKEN LIMITS ──────────────────────────
export const userTokenLimits = pgTable('user_token_limits', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  module: text('module').notNull(),
  dailyLimit: bigint('daily_limit', { mode: 'number' }).default(-1),
  monthlyLimit: bigint('monthly_limit', { mode: 'number' }).default(-1),
  maxCostPerCall: bigint('max_cost_per_call', { mode: 'number' }).default(-1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    uniqueUserModule: uniqueIndex('idx_user_token_limits_unique').on(table.tenantId, table.userId, table.module),
  };
});

// ── 4. API KEYS REGISTRY ──────────────────────────────
export const apiKeysRegistry = pgTable('api_keys_registry', {
  id: utils.pk(),
  service: text('service').notNull(),
  keyName: text('key_name').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyPrefix: text('key_prefix'),
  isActive: boolean('is_active').default(true),
  isPrimary: boolean('is_primary').default(false),
  monthlyBudgetCents: bigint('monthly_budget_cents', { mode: 'number' }).default(-1),
  currentMonthCents: bigint('current_month_cents', { mode: 'number' }).default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  rateLimitPerMin: integer('rate_limit_per_min'),
  rateLimitPerDay: integer('rate_limit_per_day'),
  notes: text('notes'),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id),
}, (table) => {
  return {
    serviceIdx: index('idx_api_keys_reg_service').on(table.service, table.isActive),
  };
});

// ── 5. USAGE ALERTS ───────────────────────────────────
export const usageAlerts = pgTable('usage_alerts', {
  id: utils.pk(),
  alertType: text('alert_type').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  service: text('service'),
  currentValue: bigint('current_value', { mode: 'number' }),
  thresholdValue: bigint('threshold_value', { mode: 'number' }),
  message: text('message'),
  notificationSent: text('notification_sent'),
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    targetIdx: index('idx_usage_alerts_target').on(table.targetType, table.targetId),
    unackedIdx: index('idx_usage_alerts_unacked').on(table.acknowledged),
  };
});

// ── 6. COST ANOMALIES ─────────────────────────────────
export const costAnomalies = pgTable('cost_anomalies', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  service: text('service').notNull(),
  expectedDailyCents: bigint('expected_daily_cents', { mode: 'number' }),
  actualDailyCents: bigint('actual_daily_cents', { mode: 'number' }),
  deviationPct: decimal('deviation_pct', { precision: 10, scale: 2 }),
  suspectedCause: text('suspected_cause'),
  actionTaken: text('action_taken'),
  reviewed: boolean('reviewed').default(false),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    unreviewedIdx: index('idx_cost_anomalies_unreviewed').on(table.reviewed),
  };
});

// ── 7. OAUTH 2.0 CLIENTS ───────────────────────────────
export const oauthClients = pgTable('oauth_clients', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret').notNull(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    clientIdIdx: uniqueIndex('idx_oauth_clients_client_id').on(table.clientId),
    tenantIdx: index('idx_oauth_clients_tenant').on(table.tenantId),
  };
});

// ── 8. OAUTH 2.0 AUTHORIZATION CODES ───────────────────
export const oauthCodes = pgTable('oauth_codes', {
  id: utils.pk(),
  clientId: uuid('client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    codeIdx: uniqueIndex('idx_oauth_codes_code').on(table.code),
    clientIdx: index('idx_oauth_codes_client').on(table.clientId),
  };
});

// ── 9. OAUTH 2.0 ACCESS TOKENS ─────────────────────────
export const oauthTokens = pgTable('oauth_tokens', {
  id: utils.pk(),
  clientId: uuid('client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token').notNull().unique(),
  refreshToken: text('refresh_token').unique(),
  scope: text('scope'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    accessTokenIdx: uniqueIndex('idx_oauth_tokens_access').on(table.accessToken),
    refreshTokenIdx: index('idx_oauth_tokens_refresh').on(table.refreshToken),
    clientIdx: index('idx_oauth_tokens_client').on(table.clientId),
    userIdx: index('idx_oauth_tokens_user').on(table.userId),
  };
});

// ── 10. PORTAL CLIENTS (Client Portal) ──────────────────
export const portalClients = pgTable('portal_clients', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  name: text('name').notNull(),
  email: text('email').notNull(),
  accessToken: text('access_token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    emailIdx: index('idx_portal_clients_email').on(table.email),
    tokenIdx: uniqueIndex('idx_portal_clients_token').on(table.accessToken),
  };
});

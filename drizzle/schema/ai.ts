/**
 * AI Gateway Schema
 *
 * Two tables to support the multi-provider AI gateway:
 *
 *  1. `ai_provider_secrets` — per-tenant, per-provider encrypted API keys.
 *     Replaces the previous `tenants.settings.ai_providers.<id>.api_key_set`
 *     marker (which stored a presence boolean only). Real keys are encrypted
 *     with `lib/crypto.encrypt()` under `ENCRYPTION_KEY` (same pattern SSO
 *     uses for `client_secret`).
 *
 *  2. `ai_activity` — one row per gateway call. Drives:
 *       - the AI Hub status counters (drafts/scoring/tokens today)
 *       - the AI Activity Log page
 *       - super-admin AI usage reporting
 *       - acceptance-rate tracking (was the suggestion kept?)
 */
import {
  pgTable, uuid, text, timestamp, boolean, integer, bigint, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';
import { users } from './core';

// ── 1. AI PROVIDER SECRETS ───────────────────────────
// Per-tenant encrypted API keys for the multi-provider gateway.
// Supports three key types:
//   - 'system'  — Platform-provided key (superadmin sets via /superadmin/ai-keys)
//   - 'tenant'  — Organization/workspace key (admin sets via /tenant/settings/ai-providers)
//   - 'personal' — User's own key (user sets via /tenant/settings/ai-keys)
// Lookup order: personal → tenant → system (first found wins)
// One row per (tenant, provider, keyType). Soft-deletable.
export const aiProviderSecrets = pgTable('ai_provider_secrets', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** 'openai' | 'anthropic' | 'groq' | 'ollama' | 'opencode' */
  provider: text('provider').notNull(),
  /** 'system' | 'tenant' | 'personal' — who owns this key */
  keyType: text('key_type').notNull().default('tenant'),
  /** For personal keys: which user owns this key. Null for system/tenant keys. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** AES-256-GCM ciphertext from lib/crypto.encrypt() */
  encryptedKey: text('encrypted_key').notNull(),
  /** Last 4 chars of the plaintext key, safe to display */
  keyPrefix: text('key_prefix'),
  /** Optional self-hosted base URL. Plain text — not a secret. */
  baseUrl: text('base_url'),
  /** Optional model override — stored per-key so each user can use their own model. */
  modelOverride: text('model_override'),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  uniqueTenantProviderType: uniqueIndex('idx_ai_provider_secrets_unique')
    .on(table.tenantId, table.provider, table.keyType)
    .where(sql`deleted_at IS NULL`),
  uniquePersonalKey: uniqueIndex('idx_ai_provider_secrets_personal')
    .on(table.tenantId, table.provider, table.userId)
    .where(sql`deleted_at IS NULL AND key_type = 'personal'`),
  activeIdx: utils.activeIdx(table),
  userIdx: index('idx_ai_provider_secrets_user').on(table.userId),
}));

// ── 2. AI ACTIVITY LOG ───────────────────────────────
// One row per gateway invocation. Read by /api/tenant/ai/status,
// /api/tenant/ai/activity, /superadmin/ai-usage.
export const aiActivity = pgTable('ai_activity', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Capability: 'draft' | 'lead_scoring' | 'predict_deal' | 'enrich_contact' | 'suggest_followup' | 'summarize' */
  action: text('action').notNull(),
  /** Provider that actually answered: 'openai' | 'anthropic' | 'groq' | 'ollama' */
  provider: text('provider').notNull(),
  /** Resolved model name, e.g. 'gpt-4o-mini' */
  model: text('model'),
  /** 'success' | 'error' | 'rate_limited' | 'fallback_used' */
  status: text('status').notNull().default('success'),
  /** Input tokens (prompt) */
  tokensIn: integer('tokens_in').default(0),
  /** Output tokens (completion) */
  tokensOut: integer('tokens_out').default(0),
  /** Total tokens used (in + out, denormalised for fast SUM) */
  tokensUsed: integer('tokens_used').default(0),
  /** Computed cost in 1/100ths of a cent (six-decimal precision) */
  costCents: bigint('cost_cents', { mode: 'number' }).default(0),
  /** Wall-clock latency, ms */
  latencyMs: integer('latency_ms'),
  /** Optional reference to the entity the call was about (deal_id, contact_id, etc.) */
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  /** Error message when status != 'success' */
  errorMessage: text('error_message'),
  /** Did the user accept / use the suggestion? Set later via PATCH. */
  accepted: boolean('accepted'),
  /** Free-form details (provider raw usage, fallback chain, etc.) */
  metadata: utils.metadata(),
  createdAt: utils.createdAt(),
}, (table) => ({
  tenantIdx: index('idx_ai_activity_tenant_time').on(table.tenantId, table.createdAt),
  actionIdx: index('idx_ai_activity_action').on(table.tenantId, table.action, table.createdAt),
  userIdx: index('idx_ai_activity_user').on(table.tenantId, table.userId, table.createdAt),
  statusIdx: index('idx_ai_activity_status').on(table.tenantId, table.status),
}));

// ── 3. AI DRAFT TEMPLATES ────────────────────────────
// Per-tenant prompt templates for the Auto-Draft surface
// (/tenant/ai/draft). Each template captures kind (email / note / reply
// / call_prep), entity types it applies to, system + user prompt, and
// default tone/subject. Soft-delete on edit. Unique on (tenant, slug).
export const aiDraftTemplates = pgTable('ai_draft_templates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** Stable slug, e.g. 'follow-up-after-demo' */
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** 'email' | 'note' | 'reply' | 'call_prep' */
  kind: text('kind').notNull().default('email'),
  /** Comma-separated entity types this template can target */
  entityTypes: text('entity_types').notNull().default('contact,deal'),
  /** System prompt — sets tone / persona / output format */
  systemPrompt: text('system_prompt').notNull(),
  /** User prompt template — supports {{contact.first_name}}, {{deal.title}} etc. */
  userPrompt: text('user_prompt').notNull(),
  /** Default tone hint surfaced in the picker UI */
  tone: text('tone').default('professional'),
  /** Optional default subject line (email kind only) */
  defaultSubject: text('default_subject'),
  active: boolean('active').notNull().default(true),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  slugUnique: uniqueIndex('idx_ai_draft_templates_slug')
    .on(table.tenantId, table.slug)
    .where(sql`deleted_at IS NULL`),
  kindIdx: index('idx_ai_draft_templates_kind').on(table.tenantId, table.kind, table.active),
}));

// ── 4. LEAD SCORING RULES ───────────────────────────
// Per-tenant rules that drive the AI lead scoring engine.
// Each rule has a factor (e.g. 'Company Size'), a weight (-100 to 100),
// and a condition (e.g. 'revenue > 1M').
export const leadScoringRules = pgTable('lead_scoring_rules', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** Human-readable factor name, e.g. 'Role matches persona' */
  factor: text('factor').notNull(),
  /** Importance: positive = bonus, negative = penalty. Typically -100 to 100. */
  weight: integer('weight').notNull().default(10),
  /** Optional machine-readable condition or prompt hint */
  condition: text('condition'),
  /** Order in the settings UI */
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  activeIdx: utils.activeIdx(table),
}));

// ── 5. AT-RISK RULES ────────────────────────────────
// Per-tenant rules for flagging deals as 'at risk'.
// Flagged deals are shown in /tenant/ai/at-risk.
export const atRiskRules = pgTable('at_risk_rules', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** 
   * Deal stage this rule applies to. 
   * If null, it's a global rule (fallback).
   */
  stageId: uuid('stage_id'),
  /** 
   * Flag if no activity for X days. 
   * Activity = notes, emails, calls, meetings, or field updates.
   */
  maxDaysIdle: integer('max_days_idle').notNull().default(14),
  /** 
   * Flag if deal has been in this stage for longer than X days,
   * regardless of activity. Useful for 'Negotiation' or 'Contract' stages.
   */
  maxDaysInStage: integer('max_days_in_stage'),
  /** 
   * Flag if sentiment score falls below X (0-100).
   * Sentiment is extracted from the latest email reply using AI.
   */
  sentimentThreshold: integer('sentiment_threshold').default(30),
  /** Optional custom notes for why this stage has these rules */
  description: text('description'),
  active: boolean('active').notNull().default(true),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  stageIdx: index('idx_at_risk_rules_stage').on(table.tenantId, table.stageId),
  activeIdx: utils.activeIdx(table),
}));

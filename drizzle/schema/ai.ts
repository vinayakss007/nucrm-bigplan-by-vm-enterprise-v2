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
import { tenants, users } from './core';

// ── 1. AI PROVIDER SECRETS ───────────────────────────
// Per-tenant encrypted API keys for the multi-provider gateway.
// One row per (tenant, provider). Soft-deletable.
export const aiProviderSecrets = pgTable('ai_provider_secrets', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** 'openai' | 'anthropic' | 'groq' | 'ollama' (ollama uses base_url, no key) */
  provider: text('provider').notNull(),
  /** AES-256-GCM ciphertext from lib/crypto.encrypt() */
  encryptedKey: text('encrypted_key').notNull(),
  /** Last 4 chars of the plaintext key, safe to display */
  keyPrefix: text('key_prefix'),
  /** Optional self-hosted base URL (Ollama only). Plain text — not a secret. */
  baseUrl: text('base_url'),
  ...utils.lifecycle(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  uniqueTenantProvider: uniqueIndex('idx_ai_provider_secrets_unique')
    .on(table.tenantId, table.provider)
    .where(sql`deleted_at IS NULL`),
  activeIdx: utils.activeIdx(table),
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

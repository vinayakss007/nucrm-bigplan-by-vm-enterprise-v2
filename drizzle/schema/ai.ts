/**
 * AI gateway tables.
 *
 * Two-level model:
 *  - ai_providers          (super-admin): catalog of allowed providers + global defaults
 *  - tenant_ai_credentials (tenant):     BYO API key / model per tenant; needs super-admin approval
 *
 * The AI gateway in lib/ai/gateway.ts ONLY calls a tenant_ai_credentials row
 * whose status === 'approved' AND whose linked ai_providers row is enabled.
 */

import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// Catalog of providers the platform supports (super-admin maintained).
// Examples: openai, anthropic, groq, mistral, ollama, openai-compatible
export const aiProviders = pgTable('ai_providers', {
  id: utils.pk(),
  // Stable lower-case identifier used by the gateway switch.
  // 'openai' | 'anthropic' | 'groq' | 'mistral' | 'ollama' | 'openai-compatible'
  providerKey: text('provider_key').notNull(),
  displayName: text('display_name').notNull(),
  // Default base URL when none is provided by a tenant credential.
  defaultBaseUrl: text('default_base_url'),
  // Whether super-admin has globally enabled this provider.
  enabled: boolean('enabled').notNull().default(true),
  // Whether this provider supports server-sent streaming.
  supportsStreaming: boolean('supports_streaming').notNull().default(true),
  // Whether tenants may use the platform's default key when no BYO key is set.
  // Set to false to force every tenant to bring their own key + go through approval.
  allowPlatformKey: boolean('allow_platform_key').notNull().default(false),
  // Optional rate caps applied platform-wide for this provider.
  rateLimits: jsonb('rate_limits').default({}),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => ({
  providerKeyIdx: unique('uniq_ai_providers_provider_key').on(table.providerKey),
  enabledIdx: index('idx_ai_providers_enabled').on(table.enabled),
  metadataGinIdx: utils.metadataIdx(table),
  activeIdx: utils.activeIdx(table),
}));

// Tenant-level BYO credentials. status pending → super-admin approves/rejects.
export const tenantAiCredentials = pgTable('tenant_ai_credentials', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  providerId: uuid('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
  // Default model for this credential, e.g. 'gpt-4o-mini', 'claude-3-5-haiku-20241022'
  model: text('model').notNull(),
  // Encrypted via lib/crypto/secrets.ts (pgcrypto or app-level AES-GCM).
  // NEVER store plaintext keys.
  encryptedApiKey: text('encrypted_api_key').notNull(),
  // Optional override of the provider's default base URL (for self-hosted Ollama, OpenAI proxies, etc.).
  baseUrlOverride: text('base_url_override'),
  // 'pending' | 'approved' | 'rejected' | 'revoked'
  status: text('status').notNull().default('pending'),
  // Free-form rejection / revocation reason captured at decision time.
  decisionReason: text('decision_reason'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // Optional fallback chain — provider keys, in priority order, used by gateway on failure.
  fallbackChain: jsonb('fallback_chain').default([]),
  // Last time this credential successfully completed a call (used for monitoring / surfacing stale keys).
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  // Aggregated counters for ops dashboards.
  callCount: integer('call_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  providerIdx: index('idx_tenant_ai_credentials_provider').on(table.providerId),
  statusIdx: index('idx_tenant_ai_credentials_tenant_status').on(table.tenantId, table.status),
  // One primary credential per tenant+provider; tenants who want multiple keys
  // for the same provider can keep older ones with status='revoked'.
  uniqueActive: unique('uniq_tenant_ai_credential_active').on(table.tenantId, table.providerId, table.status),
  metadataGinIdx: utils.metadataIdx(table),
  activeIdx: utils.activeIdx(table),
}));

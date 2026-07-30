/**
 * Table registry entries for the `tokens` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  tokenBudgets,
  tenantTokenLimits,
  userTokenLimits,
  apiKeysRegistry,
  usageAlerts,
  costAnomalies,
  oauthClients,
  oauthCodes,
  oauthTokens,
  portalClients,
} from '../tokens';

export const TOKENS_TABLES = {

  // Tokens tables
  tokenBudgets: {
    table: tokenBudgets,
    metadata: {
      name: 'token_budgets',
      schemaGroup: 'tokens',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Service token budget tracking',
      isCore: true,
      indexes: ['idx_token_budgets_service_period', 'idx_token_budgets_service'],
    },
  },
  tenantTokenLimits: {
    table: tenantTokenLimits,
    metadata: {
      name: 'tenant_token_limits',
      schemaGroup: 'tokens',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Per-tenant token usage limits',
      isCore: false,
      indexes: [],
    },
  },
  userTokenLimits: {
    table: userTokenLimits,
    metadata: {
      name: 'user_token_limits',
      schemaGroup: 'tokens',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Per-user token usage limits',
      isCore: false,
      indexes: ['idx_user_token_limits_tenant', 'idx_user_token_limits_unique'],
    },
  },
  apiKeysRegistry: {
    table: apiKeysRegistry,
    metadata: {
      name: 'api_keys_registry',
      schemaGroup: 'tokens',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'System-wide API key registry',
      isCore: true,
      indexes: ['idx_api_keys_registry_service'],
    },
  },
  usageAlerts: {
    table: usageAlerts,
    metadata: {
      name: 'usage_alerts',
      schemaGroup: 'tokens',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'Usage threshold alerts',
      isCore: true,
      indexes: ['idx_usage_alerts_target', 'idx_usage_alerts_unacked'],
    },
  },
  costAnomalies: {
    table: costAnomalies,
    metadata: {
      name: 'cost_anomalies',
      schemaGroup: 'tokens',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'AI cost anomaly detection',
      isCore: false,
      indexes: ['idx_cost_anomalies_tenant', 'idx_cost_anomalies_unreviewed'],
    },
  },

  oauthClients: {
    table: oauthClients,
    metadata: {
      name: 'oauth_clients',
      schemaGroup: 'tokens',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'OAuth 2.0 client registrations',
      isCore: false,
      indexes: ['idx_oauth_clients_client_id', 'idx_oauth_clients_tenant'],
    },
  },
  oauthCodes: {
    table: oauthCodes,
    metadata: {
      name: 'oauth_codes',
      schemaGroup: 'tokens',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['oauthClients', 'users'],
      description: 'OAuth 2.0 authorization codes',
      isCore: false,
      indexes: ['idx_oauth_codes_code', 'idx_oauth_codes_client'],
    },
  },
  oauthTokens: {
    table: oauthTokens,
    metadata: {
      name: 'oauth_tokens',
      schemaGroup: 'tokens',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['oauthClients', 'users'],
      description: 'OAuth 2.0 access and refresh tokens',
      isCore: false,
      indexes: ['idx_oauth_tokens_access', 'idx_oauth_tokens_refresh', 'idx_oauth_tokens_client', 'idx_oauth_tokens_user'],
    },
  },
  portalClients: {
    table: portalClients,
    metadata: {
      name: 'portal_clients',
      schemaGroup: 'tokens',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Client portal access tokens',
      isCore: false,
      indexes: ['idx_portal_clients_tenant', 'idx_portal_clients_email', 'idx_portal_clients_token'],
    },
  },
};

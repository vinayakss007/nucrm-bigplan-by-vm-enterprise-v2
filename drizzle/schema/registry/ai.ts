/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `ai` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  aiProviderSecrets,
  aiActivity,
  aiDraftTemplates,
  leadScoringRules,
  atRiskRules,
} from '../ai';

export const AI_TABLES = {
  aiProviderSecrets: {
    table: aiProviderSecrets,
    metadata: {
      name: 'ai_provider_secrets',
      schemaGroup: 'ai',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Encrypted per-tenant per-provider API keys for the AI gateway',
      isCore: false,
      indexes: ['idx_ai_provider_secrets_tenant', 'idx_ai_provider_secrets_unique', 'idx_ai_provider_secrets_active'],
    },
  },
  aiActivity: {
    table: aiActivity,
    metadata: {
      name: 'ai_activity',
      schemaGroup: 'ai',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Per-call AI gateway invocation log',
      isCore: false,
      indexes: ['idx_ai_activity_tenant_time', 'idx_ai_activity_action', 'idx_ai_activity_user', 'idx_ai_activity_status'],
    },
  },
  aiDraftTemplates: {
    table: aiDraftTemplates,
    metadata: {
      name: 'ai_draft_templates',
      schemaGroup: 'ai',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Per-tenant Auto-Draft prompt templates (email / note / reply / call_prep)',
      isCore: false,
      indexes: ['idx_ai_draft_templates_slug', 'idx_ai_draft_templates_kind'],
    },
  },
  leadScoringRules: {
    table: leadScoringRules,
    metadata: {
      name: 'lead_scoring_rules',
      schemaGroup: 'ai',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Factors for AI lead scoring',
      isCore: false,
      indexes: ['idx_lead_scoring_rules_tenant', 'idx_lead_scoring_rules_active'],
    },
  },
  atRiskRules: {
    table: atRiskRules,
    metadata: {
      name: 'at_risk_rules',
      schemaGroup: 'ai',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Rules for flagging deals as at-risk',
      isCore: false,
      indexes: ['idx_at_risk_rules_tenant', 'idx_at_risk_rules_active'],
    },
  },
};

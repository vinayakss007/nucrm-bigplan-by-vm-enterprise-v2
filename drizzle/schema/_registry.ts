/**
 * NuCRM - Drizzle Schema Registry
 * 
 * Centralized table registry for deployment, validation, and type-safe access.
 * This file serves as the single source of truth for all database tables.
 */

import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// =============================================================================
// TABLE DEFINITION TYPES
// =============================================================================

/** Metadata about a table for deployment and validation */
export interface TableMetadata {
  name: string;
  schemaGroup: SchemaGroup;
  hasTenantId: boolean;
  hasSoftDelete: boolean;
  hasAudit: boolean;
  hasMetadata: boolean;
  dependencies: string[]; // table names this table depends on
  description: string;
  isCore: boolean;
  indexes: string[];
}

/** Group categorization for tables */
export type SchemaGroup = 
  | 'core'       // tenants, users, roles, auth
  | 'crm'        // contacts, deals, companies, pipelines
  | 'comm'       // emails, calls, meetings, templates
  | 'automation' // workflows, triggers, actions
  | 'infra'      // system settings, backups, announcements
  | 'marketing'  // campaigns, forms, assets
  | 'support'    // tickets, conversations
  | 'knowledge'  // KB articles, categories
  | 'tokens'     // API keys, sessions
  | 'modules'    // custom modules, extensions
  | 'segments'   // contact segments, lists
  | 'ai'         // ai provider secrets, activity, templates
  | 'billing'    // invoices, payments, subscriptions
  | 'history'    // audit trails, field snapshots
  | 'documents'  // document storage, folders
  | 'esignature' // electronic signatures
  | 'projects'   // project management
;

/** Complete table registry entry */
export interface TableRegistryEntry {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  metadata: TableMetadata;
}

/** Union type of all table names for type safety */
export type TableName = keyof typeof TABLE_REGISTRY;

// =============================================================================
// TABLE IMPORTS
// =============================================================================

import {
  tenants,
  users,
  refreshTokens,
  passwordResets,
  tenantMembers,
  roles,
  sessions,
  impersonationSessions,
  fieldPermissions,
  recordPermissions,
  approvalRequests,
  apiKeys,
  apiKeyUsage,
  auditLogs,
  notifications,
  invitations,
  featureRegistry,
} from './core';

import {
  companies,
  contacts,
  leads,
  pipelines,
  dealStages,
  deals,
  customFieldDefs,
  customFields,
  forms,
  products,
  quotes,
  quoteLineItems,
  priceBooks,
  priceBookEntries,
  pipelineHealthMetrics,
  tags,
  entityTags,
  notes,
  dealProducts,
  formSubmissions,
  contactEmails,
  contactLifecycleHistory,
  contactMergeHistory,
  contactScores,
  dealForecasts,
  fileAttachments,
  leadActivities,
  leadAssignments,
  pipelineStages,
  meetings,
  churnPredictions,
  callNotes,
  callRecordings,
  conversationMetrics,
  conversationKeywords,
  revenueProjections,
  savedViews,
  contactTags,
  leadOffers,
  leadTags,
  followUps,
} from './crm';

import {
  whatsappConversations,
  whatsappMessages,
  voiceCalls,
  callLogs,
  emailTemplates,
  emailDrafts,
  emailTracking,
  integrations,
  emailLog,
  emailVerifications,
  emailWarmupConfigs,
  emailWarmupPool,
  emailWarmupLogs,
  webhookInboundLogs,
  whatsappTemplates,
} from './comm';

import {
  automations,
  automationRuns,
  workflows,
  workflowActions,
  workflowExecutions,
  workflowActionLogs,
  webhooks,
  webhookDeliveries,
  aiInsights,
  aiUsageLogs,
  aiUsage,
  aiEmailDrafts as aiEmailDraftsAutomation,
  contentGenerations,
  revenueOpportunities,
  aiModuleConfigs,
  aiUsageAggregated,
  automationWorkflows,
  workflowExecutionLogs,
  deadLetterQueue,
  scheduledReports,
} from './automation';

import {
  systemSettings,
  plans,
  subscriptions,
  activities,
  tasks,
  tenantBackups,
  tenantRestores,
  dashboards,
  savedReports,
  billingEvents,
  usageSnapshots,
  limitViolations,
  fileUploads,
  announcements,
  tenantBackupRecords,
  tenantRestoreRecords,
  backupAlerts,
  backupRecords,
  backupSchedules,
  criticalDataBackups,
  permissionOverrides,
  healthChecks,
  onboardingProgress,
  platformSettings,
  reportExecutions,
  revenueForecastSummary,
  restoreSnapshots,
  selectiveRestoreAuditLog,
  selectiveRestoreLogs,
  superAdminBackups,
  userDepartures,
  apiKeyUsageInfra,
  dashboardTemplates,
  reportTemplates,
  ssoProviders,
  ssoSessions,
} from './infra';

import {
  sequences,
  sequenceSteps,
  sequenceStepLogs,
  sequenceEnrollments,
} from './marketing';

import {
  errorLogs,
  webhookQueue,
  failedWebhooks,
  supportTickets,
  ticketReplies,
} from './support';

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
} from './tokens';

import {
  modules,
  tenantModules,
} from './modules';

import {
  customPlugins,
  pluginExecutionLogs,
} from './plugins';

import {
  segments,
  segmentMembers,
} from './segments';

import {
  kbCategories,
  kbArticles,
} from './knowledge';

import {
  loginAttempts,
  loginBlocks,
  securityEvents,
} from './security';

import {
  services,
  serviceCategories,
  invoices,
  invoiceLineItems,
  invoicePayments,
  orders,
  orderLineItems,
  contracts,
  serviceSubscriptions,
} from './billing';

import {
  editHistory,
  fieldSnapshots,
} from './history';

import {
  productTemplates,
  tenantTemplates,
} from './templates';

import {
  aiProviderSecrets,
  aiActivity,
  aiDraftTemplates,
  leadScoringRules,
  atRiskRules,
} from './ai';

import {
  assignmentRules,
  assignmentLogs,
} from './assignment';

import {
  chatSessions,
  chatMessages,
} from './chat';

import {
  complianceRequests,
  dataRetentionPolicies,
} from './compliance';

import {
  dashboardLayouts,
} from './dashboard';

import {
  documentFolders,
  documents as documentRecords,
} from './documents';

import {
  emailOpens,
  emailClicks,
} from './email-tracking';

import {
  signingRequests,
  signingEvents,
} from './esignature';

import {
  exchangeRates,
  taxRates,
  taxExemptions,
} from './financial';

import {
  tenantHierarchy,
  hierarchyPermissions,
} from './hierarchy';

import {
  leadWarmingEvents,
  leadWarmingCampaigns,
  leadWarmingMessages,
  leadWarmingReplies,
  leadWarmingSchedule,
} from './lead-warming';

import {
  projects,
  milestones,
  projectTasks,
} from './projects';

import {
  slaPolicies,
  slaBreaches,
} from './sla';

import {
  smsMessages,
  smsTemplates,
} from './sms';

import {
  territories,
  territoryAssignments,
} from './territories';

import {
  userUsage,
  planLimits,
} from './usage';

import {
  visitors,
  pageViews,
} from './visitors';

import {
  documents as storageDocuments,
} from './files';

// =============================================================================
// TABLE REGISTRY DEFINITION
// =============================================================================

export const TABLE_REGISTRY = {
  // Core tables
  tenants: {
    table: tenants,
    metadata: {
      name: 'tenants',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: [],
      description: 'Root tenant/organization records',
      isCore: true,
      indexes: ['idx_tenants_slug', 'idx_tenants_subdomain', 'idx_tenants_metadata_g'],
    },
  },
  users: {
    table: users,
    metadata: {
      name: 'users',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: [],
      description: 'User accounts',
      isCore: true,
      indexes: ['idx_users_email', 'idx_users_metadata_g', 'idx_users_active'],
    },
  },
  refreshTokens: {
    table: refreshTokens,
    metadata: {
      name: 'refresh_tokens',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'Refresh tokens for auth',
      isCore: true,
      indexes: [],
    },
  },
  passwordResets: {
    table: passwordResets,
    metadata: {
      name: 'password_resets',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'Password reset records',
      isCore: true,
      indexes: [],
    },
  },
  tenantMembers: {
    table: tenantMembers,
    metadata: {
      name: 'tenant_members',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users', 'roles'],
      description: 'Tenant membership and roles',
      isCore: true,
      indexes: ['idx_tenants_tenant', 'idx_tenant_members_user', 'idx_tenant_members_tenant_user'],
    },
  },
  roles: {
    table: roles,
    metadata: {
      name: 'roles',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'RBAC roles',
      isCore: true,
      indexes: ['idx_roles_tenant', 'idx_roles_tenant_slug'],
    },
  },
  sessions: {
    table: sessions,
    metadata: {
      name: 'sessions',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'User sessions',
      isCore: true,
      indexes: ['idx_sessions_token'],
    },
  },
  impersonationSessions: {
    table: impersonationSessions,
    metadata: {
      name: 'impersonation_sessions',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users', 'tenants'],
      description: 'Admin impersonation history',
      isCore: true,
      indexes: ['idx_impersonation_sessions_active'],
    },
  },
  fieldPermissions: {
    table: fieldPermissions,
    metadata: {
      name: 'field_permissions',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'roles'],
      description: 'Field-level security',
      isCore: true,
      indexes: ['idx_field_permissions_unique'],
    },
  },
  recordPermissions: {
    table: recordPermissions,
    metadata: {
      name: 'record_permissions',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'roles', 'users'],
      description: 'Record-level security',
      isCore: true,
      indexes: ['idx_record_permissions_entity', 'idx_record_permissions_role'],
    },
  },
  approvalRequests: {
    table: approvalRequests,
    metadata: {
      name: 'approval_requests',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Approval workflow requests',
      isCore: true,
      indexes: ['idx_approval_requests_entity', 'idx_approval_requests_status'],
    },
  },
  apiKeys: {
    table: apiKeys,
    metadata: {
      name: 'api_keys',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'API key management',
      isCore: true,
      indexes: ['idx_api_keys_tenant', 'idx_api_keys_metadata_g'],
    },
  },
  apiKeyUsage: {
    table: apiKeyUsage,
    metadata: {
      name: 'api_key_usage',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['apiKeys', 'tenants'],
      description: 'API key usage logs',
      isCore: true,
      indexes: [],
    },
  },
  auditLogs: {
    table: auditLogs,
    metadata: {
      name: 'audit_logs',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'System audit logs',
      isCore: true,
      indexes: ['idx_audit_logs_tenant', 'idx_audit_logs_entity', 'idx_audit_logs_metadata_g'],
    },
  },
  notifications: {
    table: notifications,
    metadata: {
      name: 'notifications',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'User notifications',
      isCore: true,
      indexes: ['idx_notifications_tenant', 'idx_notifications_user', 'idx_notifications_metadata_g'],
    },
  },
  invitations: {
    table: invitations,
    metadata: {
      name: 'invitations',
      schemaGroup: 'core',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tenant invitations',
      isCore: true,
      indexes: ['idx_invitations_tenant'],
    },
  },
  featureRegistry: {
    table: featureRegistry,
    metadata: {
      name: 'feature_registry',
      schemaGroup: 'core',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Feature flags registry',
      isCore: true,
      indexes: ['idx_feature_registry_enabled'],
    },
  },

  // CRM tables
  companies: {
    table: companies,
    metadata: {
      name: 'companies',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Company records',
      isCore: false,
      indexes: ['idx_companies_tenant', 'idx_companies_name', 'idx_companies_metadata_g', 'idx_companies_active'],
    },
  },
  contacts: {
    table: contacts,
    metadata: {
      name: 'contacts',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'companies', 'users'],
      description: 'Contact records',
      isCore: false,
      indexes: ['idx_contacts_tenant', 'idx_contacts_company', 'idx_contacts_email', 'idx_contacts_tenant_status', 'idx_contacts_active', 'idx_contacts_metadata_g'],
    },
  },
  leads: {
    table: leads,
    metadata: {
      name: 'leads',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'companies', 'contacts'],
      description: 'Unqualified leads',
      isCore: false,
      indexes: ['idx_leads_tenant', 'idx_leads_email', 'idx_leads_tenant_status', 'idx_leads_metadata_g', 'idx_leads_active'],
    },
  },
  pipelines: {
    table: pipelines,
    metadata: {
      name: 'pipelines',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Sales pipelines',
      isCore: false,
      indexes: ['idx_pipelines_tenant', 'idx_pipelines_metadata_g'],
    },
  },
  dealStages: {
    table: dealStages,
    metadata: {
      name: 'deal_stages',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['pipelines'],
      description: 'Pipeline stages',
      isCore: false,
      indexes: ['idx_deal_stages_pipeline', 'idx_deal_stages_metadata_g'],
    },
  },
  deals: {
    table: deals,
    metadata: {
      name: 'deals',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'pipelines', 'dealStages', 'users'],
      description: 'Sales deals',
      isCore: false,
      indexes: ['idx_deals_tenant', 'idx_deals_contact', 'idx_deals_stage', 'idx_deals_active', 'idx_deals_metadata_g'],
    },
  },
  customFieldDefs: {
    table: customFieldDefs,
    metadata: {
      name: 'custom_field_defs',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Custom field definitions',
      isCore: false,
      indexes: ['idx_custom_fields_tenant_entity', 'idx_custom_fields_key', 'idx_custom_fields_unique_key'],
    },
  },
  forms: {
    table: forms,
    metadata: {
      name: 'forms',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Web forms',
      isCore: false,
      indexes: ['idx_forms_tenant', 'idx_forms_active'],
    },
  },
  products: {
    table: products,
    metadata: {
      name: 'products',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Product catalog',
      isCore: false,
      indexes: ['idx_products_tenant', 'idx_products_metadata_g', 'idx_products_active'],
    },
  },
  quotes: {
    table: quotes,
    metadata: {
      name: 'quotes',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'deals'],
      description: 'Sales quotes',
      isCore: false,
      indexes: ['idx_quotes_tenant', 'idx_quotes_deal', 'idx_quotes_metadata_g', 'idx_quotes_active'],
    },
  },
  quoteLineItems: {
    table: quoteLineItems,
    metadata: {
      name: 'quote_line_items',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['quotes', 'products'],
      description: 'Quote line items',
      isCore: false,
      indexes: ['idx_quote_line_items_quote'],
    },
  },
  priceBooks: {
    table: priceBooks,
    metadata: {
      name: 'price_books',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Price books',
      isCore: false,
      indexes: ['idx_price_books_tenant'],
    },
  },
  priceBookEntries: {
    table: priceBookEntries,
    metadata: {
      name: 'price_book_entries',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['priceBooks', 'products'],
      description: 'Price book entries',
      isCore: false,
      indexes: ['idx_price_book_entries_unique'],
    },
  },
  pipelineHealthMetrics: {
    table: pipelineHealthMetrics,
    metadata: {
      name: 'pipeline_health_metrics',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['pipelines', 'tenants'],
      description: 'Pipeline health tracking',
      isCore: false,
      indexes: ['idx_pipeline_health_unique', 'idx_pipeline_health_metrics_tenant'],
    },
  },
  tags: {
    table: tags,
    metadata: {
      name: 'tags',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Organizational tags',
      isCore: false,
      indexes: ['idx_tags_tenant', 'idx_tags_metadata_g'],
    },
  },
  entityTags: {
    table: entityTags,
    metadata: {
      name: 'entity_tags',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'tags'],
      description: 'Polymorphic tags',
      isCore: false,
      indexes: ['idx_entity_tags_lookup', 'idx_entity_tags_tenant'],
    },
  },
  notes: {
    table: notes,
    metadata: {
      name: 'notes',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'General entity notes',
      isCore: false,
      indexes: ['idx_notes_entity', 'idx_notes_tenant', 'idx_notes_active'],
    },
  },
  dealProducts: {
    table: dealProducts,
    metadata: {
      name: 'deal_products',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['deals', 'tenants'],
      description: 'Products attached to deals',
      isCore: false,
      indexes: ['idx_deal_products_deal', 'idx_deal_products_tenant'],
    },
  },
  formSubmissions: {
    table: formSubmissions,
    metadata: {
      name: 'form_submissions',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['forms', 'tenants', 'contacts'],
      description: 'Form submission data',
      isCore: false,
      indexes: ['idx_form_submissions_form', 'idx_form_submissions_tenant', 'idx_form_submissions_contact'],
    },
  },
  contactEmails: {
    table: contactEmails,
    metadata: {
      name: 'contact_emails',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts'],
      description: 'Additional contact emails',
      isCore: false,
      indexes: ['idx_contact_emails_contact', 'idx_contact_emails_unique'],
    },
  },
  contactLifecycleHistory: {
    table: contactLifecycleHistory,
    metadata: {
      name: 'contact_lifecycle_history',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['contacts', 'tenants', 'users'],
      description: 'Contact stage history',
      isCore: false,
      indexes: ['idx_contact_lifecycle_history_contact', 'idx_contact_lifecycle_history_tenant', 'idx_contact_lifecycle_history_metadata_g'],
    },
  },
  contactMergeHistory: {
    table: contactMergeHistory,
    metadata: {
      name: 'contact_merge_history',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'users'],
      description: 'Contact merge logs',
      isCore: false,
      indexes: ['idx_contact_merge_history_tenant', 'idx_contact_merge_history_primary', 'idx_contact_merge_history_merged', 'idx_contact_merge_history_metadata_g'],
    },
  },
  contactScores: {
    table: contactScores,
    metadata: {
      name: 'contact_scores',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts', 'tenants'],
      description: 'Contact engagement scores',
      isCore: false,
      indexes: ['idx_contact_scores_tenant', 'idx_contact_scores_contact'],
    },
  },
  dealForecasts: {
    table: dealForecasts,
    metadata: {
      name: 'deal_forecasts',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'deals'],
      description: 'AI deal forecasts',
      isCore: false,
      indexes: ['idx_deal_forecasts_deal', 'idx_deal_forecasts_tenant'],
    },
  },
  fileAttachments: {
    table: fileAttachments,
    metadata: {
      name: 'file_attachments',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'File attachments for entities',
      isCore: false,
      indexes: ['idx_file_attachments_entity', 'idx_file_attachments_tenant'],
    },
  },
  leadActivities: {
    table: leadActivities,
    metadata: {
      name: 'lead_activities',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'leads', 'users'],
      description: 'Lead activity history',
      isCore: false,
      indexes: ['idx_lead_activities_tenant', 'idx_lead_activities_metadata_g'],
    },
  },
  leadAssignments: {
    table: leadAssignments,
    metadata: {
      name: 'lead_assignments',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'leads', 'users'],
      description: 'Lead assignment history',
      isCore: false,
      indexes: ['idx_lead_assignments_lead', 'idx_lead_assignments_user', 'idx_lead_assignments_tenant'],
    },
  },
  pipelineStages: {
    table: pipelineStages,
    metadata: {
      name: 'pipeline_stages',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['pipelines'],
      description: 'Pipeline stage definitions',
      isCore: false,
      indexes: ['idx_pipeline_stages_pipeline', 'idx_pipeline_stages_metadata_g'],
    },
  },
  meetings: {
    table: meetings,
    metadata: {
      name: 'meetings',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users', 'contacts', 'deals'],
      description: 'CRM meetings',
      isCore: false,
      indexes: ['idx_meetings_tenant', 'idx_meetings_user', 'idx_meetings_contact', 'idx_meetings_deal', 'idx_meetings_status', 'idx_meetings_start_time', 'idx_meetings_active'],
    },
  },
  churnPredictions: {
    table: churnPredictions,
    metadata: {
      name: 'churn_predictions',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts'],
      description: 'AI churn risk analysis',
      isCore: false,
      indexes: ['idx_churn_predictions_tenant', 'idx_churn_predictions_contact'],
    },
  },
  callNotes: {
    table: callNotes,
    metadata: {
      name: 'call_notes',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts', 'tenants', 'users'],
      description: 'AI summaries of calls',
      isCore: false,
      indexes: ['idx_call_notes_contact', 'idx_call_notes_tenant'],
    },
  },
  callRecordings: {
    table: callRecordings,
    metadata: {
      name: 'call_recordings',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts', 'tenants'],
      description: 'Call recording references',
      isCore: false,
      indexes: ['idx_call_recordings_tenant'],
    },
  },
  conversationMetrics: {
    table: conversationMetrics,
    metadata: {
      name: 'conversation_metrics',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts', 'tenants'],
      description: 'Conversation analytics',
      isCore: false,
      indexes: ['idx_conv_metrics_contact', 'idx_conversation_metrics_tenant'],
    },
  },
  conversationKeywords: {
    table: conversationKeywords,
    metadata: {
      name: 'conversation_keywords',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Keyword extraction from calls',
      isCore: false,
      indexes: ['idx_conv_keywords_tenant', 'idx_conversation_keywords_tenant'],
    },
  },
  revenueProjections: {
    table: revenueProjections,
    metadata: {
      name: 'revenue_projections',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Sales revenue forecasts',
      isCore: false,
      indexes: ['idx_rev_projections_tenant', 'idx_revenue_projections_tenant', 'idx_revenue_projections_metadata_g'],
    },
  },
  savedViews: {
    table: savedViews,
    metadata: {
      name: 'saved_views',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'User-saved list views with custom filters and columns',
      isCore: false,
      indexes: ['idx_saved_views_tenant', 'idx_saved_views_entity_tenant'],
    },
  },

  contactTags: {
    table: contactTags,
    metadata: {
      name: 'contact_tags',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['contacts', 'tags'],
      description: 'Junction table linking contacts to tags',
      isCore: false,
      indexes: [],
    },
  },
  leadOffers: {
    table: leadOffers,
    metadata: {
      name: 'lead_offers',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'leads'],
      description: 'Product/service offers made to leads',
      isCore: false,
      indexes: ['idx_lead_offers_lead', 'idx_lead_offers_tenant_status', 'idx_lead_offers_metadata_gin', 'idx_lead_offers_active'],
    },
  },
  leadTags: {
    table: leadTags,
    metadata: {
      name: 'lead_tags',
      schemaGroup: 'crm',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['leads', 'tags'],
      description: 'Junction table linking leads to tags',
      isCore: false,
      indexes: [],
    },
  },
  territories: {
    table: territories,
    metadata: {
      name: 'territories',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Hierarchical sales territory definitions',
      isCore: false,
      indexes: [],
    },
  },
  territoryAssignments: {
    table: territoryAssignments,
    metadata: {
      name: 'territory_assignments',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'territories'],
      description: 'User-territory membership assignments',
      isCore: false,
      indexes: [],
    },
  },
  visitors: {
    table: visitors,
    metadata: {
      name: 'visitors',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Website visitor tracking records',
      isCore: false,
      indexes: [],
    },
  },
  pageViews: {
    table: pageViews,
    metadata: {
      name: 'page_views',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Individual page view events',
      isCore: false,
      indexes: [],
    },
  },

  followUps: {
    table: followUps,
    metadata: {
      name: 'follow_ups',
      schemaGroup: 'crm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'leads', 'contacts', 'deals', 'users'],
      description: 'Follow-up reminders for leads, contacts, and deals',
      isCore: false,
      indexes: ['idx_follow_ups_assigned', 'idx_follow_ups_due_date', 'idx_follow_ups_status', 'idx_follow_ups_lead', 'idx_follow_ups_contact', 'idx_follow_ups_deal'],
    },
  },

  // Comm tables
  whatsappConversations: {
    table: whatsappConversations,
    metadata: {
      name: 'whatsapp_conversations',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts'],
      description: 'WhatsApp threads',
      isCore: false,
      indexes: ['idx_whatsapp_conversations_tenant', 'idx_whatsapp_conv_contact', 'idx_whatsapp_conversations_metadata_g', 'idx_whatsapp_conversations_active'],
    },
  },
  whatsappMessages: {
    table: whatsappMessages,
    metadata: {
      name: 'whatsapp_messages',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['whatsappConversations', 'tenants'],
      description: 'WhatsApp messages',
      isCore: false,
      indexes: ['idx_whatsapp_messages_conv', 'idx_whatsapp_messages_tenant', 'idx_whatsapp_messages_metadata_g'],
    },
  },
  voiceCalls: {
    table: voiceCalls,
    metadata: {
      name: 'voice_calls',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'deals'],
      description: 'Voice call records',
      isCore: false,
      indexes: ['idx_voice_calls_tenant', 'idx_voice_calls_metadata_g'],
    },
  },
  callLogs: {
    table: callLogs,
    metadata: {
      name: 'call_logs',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'deals', 'users'],
      description: 'General call logs',
      isCore: false,
      indexes: ['idx_call_logs_tenant', 'idx_call_logs_metadata_g'],
    },
  },
  emailTemplates: {
    table: emailTemplates,
    metadata: {
      name: 'email_templates',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Email templates',
      isCore: false,
      indexes: ['idx_email_templates_tenant', 'idx_email_templates_metadata_g', 'idx_email_templates_active'],
    },
  },
  aiEmailDrafts: {
    table: emailDrafts,
    metadata: {
      name: 'ai_email_drafts',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'deals'],
      description: 'AI generated email drafts',
      isCore: false,
      indexes: ['idx_ai_email_drafts_tenant', 'idx_ai_email_drafts_metadata_g'],
    },
  },
  emailTracking: {
    table: emailTracking,
    metadata: {
      name: 'email_tracking',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts'],
      description: 'Email open/click tracking',
      isCore: false,
      indexes: ['idx_email_tracking_tenant', 'idx_email_tracking_metadata_g'],
    },
  },
  integrations: {
    table: integrations,
    metadata: {
      name: 'integrations',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Third-party integrations',
      isCore: false,
      indexes: ['idx_integrations_tenant_type', 'idx_integrations_metadata_g', 'idx_integrations_tenant'],
    },
  },
  emailLog: {
    table: emailLog,
    metadata: {
      name: 'email_log',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts'],
      description: 'Outbound email logs',
      isCore: false,
      indexes: ['idx_email_log_tenant', 'idx_email_log_contact', 'idx_email_log_status'],
    },
  },
  emailVerifications: {
    table: emailVerifications,
    metadata: {
      name: 'email_verifications',
      schemaGroup: 'comm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'User email verification',
      isCore: true,
      indexes: [],
    },
  },
  emailWarmupConfigs: {
    table: emailWarmupConfigs,
    metadata: {
      name: 'email_warmup_configs',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Email warmup settings',
      isCore: false,
      indexes: ['idx_email_warmup_configs_tenant'],
    },
  },
  emailWarmupPool: {
    table: emailWarmupPool,
    metadata: {
      name: 'email_warmup_pool',
      schemaGroup: 'comm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['emailWarmupConfigs'],
      description: 'Email warmup participants',
      isCore: false,
      indexes: ['idx_email_warmup_pool_config'],
    },
  },
  webhookInboundLogs: {
    table: webhookInboundLogs,
    metadata: {
      name: 'webhook_inbound_logs',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['webhooks', 'tenants'],
      description: 'Inbound webhook logs',
      isCore: false,
      indexes: ['idx_webhook_inbound_logs_webhook', 'idx_webhook_inbound_logs_processed', 'idx_webhook_inbound_logs_tenant'],
    },
  },
  whatsappTemplates: {
    table: whatsappTemplates,
    metadata: {
      name: 'whatsapp_templates',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'WhatsApp message templates',
      isCore: false,
      indexes: ['idx_whatsapp_templates_tenant', 'idx_whatsapp_templates_unique'],
    },
  },

  emailWarmupLogs: {
    table: emailWarmupLogs,
    metadata: {
      name: 'email_warmup_logs',
      schemaGroup: 'comm',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['emailWarmupConfigs', 'emailWarmupPool'],
      description: 'Email warmup activity logs',
      isCore: false,
      indexes: ['idx_email_warmup_logs_config'],
    },
  },
  chatSessions: {
    table: chatSessions,
    metadata: {
      name: 'chat_sessions',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Live chat sessions with visitors',
      isCore: false,
      indexes: ['idx_chat_sessions_tenant', 'idx_chat_sessions_status', 'idx_chat_sessions_visitor', 'idx_chat_sessions_assigned'],
    },
  },
  chatMessages: {
    table: chatMessages,
    metadata: {
      name: 'chat_messages',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'chatSessions'],
      description: 'Individual chat messages in sessions',
      isCore: false,
      indexes: ['idx_chat_messages_session', 'idx_chat_messages_tenant'],
    },
  },
  emailOpens: {
    table: emailOpens,
    metadata: {
      name: 'email_opens',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts'],
      description: 'Email open tracking events',
      isCore: false,
      indexes: ['idx_email_opens_tenant', 'idx_email_opens_contact', 'idx_email_opens_campaign'],
    },
  },
  emailClicks: {
    table: emailClicks,
    metadata: {
      name: 'email_clicks',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts'],
      description: 'Email click tracking events',
      isCore: false,
      indexes: ['idx_email_clicks_tenant', 'idx_email_clicks_contact', 'idx_email_clicks_campaign'],
    },
  },
  smsMessages: {
    table: smsMessages,
    metadata: {
      name: 'sms_messages',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts'],
      description: 'SMS message records',
      isCore: false,
      indexes: ['idx_sms_messages_tenant', 'idx_sms_messages_contact', 'idx_sms_messages_status', 'idx_sms_messages_twilio_sid'],
    },
  },
  smsTemplates: {
    table: smsTemplates,
    metadata: {
      name: 'sms_templates',
      schemaGroup: 'comm',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'SMS template definitions',
      isCore: false,
      indexes: ['idx_sms_templates_tenant', 'idx_sms_templates_active'],
    },
  },

  // Automation tables
  automations: {
    table: automations,
    metadata: {
      name: 'automations',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Legacy automation rules',
      isCore: false,
      indexes: ['idx_automations_tenant', 'idx_automations_active'],
    },
  },
  automationRuns: {
    table: automationRuns,
    metadata: {
      name: 'automation_runs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['automations', 'tenants', 'users'],
      description: 'Legacy automation execution history',
      isCore: false,
      indexes: ['idx_automation_runs_automation', 'idx_automation_runs_tenant', 'idx_automation_runs_status', 'idx_automation_runs_metadata_g'],
    },
  },
  workflows: {
    table: workflows,
    metadata: {
      name: 'workflows',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Workflow definitions',
      isCore: false,
      indexes: ['idx_workflows_tenant', 'idx_workflows_metadata_g', 'idx_workflows_active'],
    },
  },
  workflowActions: {
    table: workflowActions,
    metadata: {
      name: 'workflow_actions',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['workflows', 'tenants'],
      description: 'Workflow action steps',
      isCore: false,
      indexes: ['idx_workflow_actions_workflow', 'idx_workflow_actions_tenant'],
    },
  },
  workflowExecutions: {
    table: workflowExecutions,
    metadata: {
      name: 'workflow_executions',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['workflows', 'tenants', 'contacts', 'leads'],
      description: 'Workflow execution history',
      isCore: false,
      indexes: ['idx_workflow_executions_tenant', 'idx_workflow_executions_workflow', 'idx_workflow_executions_metadata_g'],
    },
  },
  workflowActionLogs: {
    table: workflowActionLogs,
    metadata: {
      name: 'workflow_action_logs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['workflowExecutions', 'workflowActions', 'tenants'],
      description: 'Workflow step execution logs',
      isCore: false,
      indexes: ['idx_workflow_action_logs_execution', 'idx_workflow_action_logs_tenant'],
    },
  },
  webhooks: {
    table: webhooks,
    metadata: {
      name: 'webhooks',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Outbound webhook config',
      isCore: false,
      indexes: ['idx_webhooks_tenant', 'idx_webhooks_metadata_g'],
    },
  },
  webhookDeliveries: {
    table: webhookDeliveries,
    metadata: {
      name: 'webhook_deliveries',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['webhooks', 'tenants'],
      description: 'Outbound webhook delivery history',
      isCore: false,
      indexes: ['idx_webhook_deliveries_tenant', 'idx_webhook_deliv_payload_g'],
    },
  },
  aiInsights: {
    table: aiInsights,
    metadata: {
      name: 'ai_insights',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'AI-generated insights',
      isCore: false,
      indexes: ['idx_ai_insights_tenant', 'idx_ai_insights_metadata_g'],
    },
  },
  aiUsageLogs: {
    table: aiUsageLogs,
    metadata: {
      name: 'ai_usage_logs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Detailed AI usage logs',
      isCore: false,
      indexes: ['idx_ai_usage_logs_tenant', 'idx_ai_usage_logs_feature', 'idx_ai_usage_logs_metadata_g'],
    },
  },
  aiEmailDraftsAutomation: {
    table: aiEmailDraftsAutomation,
    metadata: {
      name: 'ai_email_drafts',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'contacts'],
      description: 'AI email drafts (automation context)',
      isCore: false,
      indexes: ['idx_ai_email_drafts_user', 'idx_ai_email_drafts_tenant', 'idx_ai_email_drafts_metadata_g'],
    },
  },
  contentGenerations: {
    table: contentGenerations,
    metadata: {
      name: 'content_generations',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'AI content generation history',
      isCore: false,
      indexes: ['idx_content_generations_tenant', 'idx_content_generations_metadata_g'],
    },
  },
  revenueOpportunities: {
    table: revenueOpportunities,
    metadata: {
      name: 'revenue_opportunities',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'AI identified revenue opportunities',
      isCore: false,
      indexes: ['idx_revenue_opportunities_tenant', 'idx_revenue_opportunities_metadata_g'],
    },
  },
  aiModuleConfigs: {
    table: aiModuleConfigs,
    metadata: {
      name: 'ai_module_configs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'AI module per-tenant config',
      isCore: false,
      indexes: ['idx_ai_module_config_unique', 'idx_ai_module_configs_tenant', 'idx_ai_module_config_gin'],
    },
  },
  aiUsageAggregated: {
    table: aiUsageAggregated,
    metadata: {
      name: 'ai_usage_aggregated',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Aggregated AI usage for billing',
      isCore: false,
      indexes: ['idx_ai_usage_agg_unique', 'idx_ai_usage_aggregated_tenant'],
    },
  },
  automationWorkflows: {
    table: automationWorkflows,
    metadata: {
      name: 'automation_workflows',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tenant workflow assignments',
      isCore: false,
      indexes: ['idx_automation_workflows_tenant', 'idx_automation_workflows_active'],
    },
  },
  workflowExecutionLogs: {
    table: workflowExecutionLogs,
    metadata: {
      name: 'workflow_execution_logs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['workflowExecutions', 'tenants'],
      description: 'Workflow execution step logs',
      isCore: false,
      indexes: ['idx_workflow_execution_logs_execution', 'idx_workflow_execution_logs_tenant', 'idx_workflow_execution_logs_level', 'idx_workflow_execution_logs_metadata_g'],
    },
  },

  deadLetterQueue: {
    table: deadLetterQueue,
    metadata: {
      name: 'dead_letter_queue',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Failed job executions awaiting retry',
      isCore: false,
      indexes: ['idx_dead_letter_status', 'idx_dead_letter_job_type', 'idx_dead_letter_created'],
    },
  },
  scheduledReports: {
    table: scheduledReports,
    metadata: {
      name: 'scheduled_reports',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Scheduled report delivery configurations',
      isCore: false,
      indexes: ['idx_scheduled_reports_status', 'idx_scheduled_reports_next_run'],
    },
  },
  assignmentRules: {
    table: assignmentRules,
    metadata: {
      name: 'assignment_rules',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Auto-assignment rules for leads/tickets/deals',
      isCore: false,
      indexes: ['idx_assignment_rules_tenant', 'idx_assignment_rules_type', 'idx_assignment_rules_active'],
    },
  },
  assignmentLogs: {
    table: assignmentLogs,
    metadata: {
      name: 'assignment_logs',
      schemaGroup: 'automation',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Assignment action audit trail',
      isCore: false,
      indexes: ['idx_assignment_logs_tenant', 'idx_assignment_logs_rule', 'idx_assignment_logs_entity', 'idx_assignment_logs_assignee'],
    },
  },

  // Infra tables
  systemSettings: {
    table: systemSettings,
    metadata: {
      name: 'system_settings',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Global system settings',
      isCore: true,
      indexes: [],
    },
  },
  plans: {
    table: plans,
    metadata: {
      name: 'plans',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Billing plans',
      isCore: true,
      indexes: ['idx_plans_name', 'idx_plans_slug', 'idx_plans_active'],
    },
  },
  subscriptions: {
    table: subscriptions,
    metadata: {
      name: 'subscriptions',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'plans'],
      description: 'Tenant subscriptions',
      isCore: true,
      indexes: ['idx_subscriptions_tenant', 'idx_subscriptions_metadata_g'],
    },
  },
  activities: {
    table: activities,
    metadata: {
      name: 'activities',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'contacts', 'deals', 'companies'],
      description: 'Global activity timeline',
      isCore: false,
      indexes: ['idx_activities_tenant', 'idx_activities_entity', 'idx_activities_contact', 'idx_activities_deal', 'idx_activities_metadata_g'],
    },
  },
  tasks: {
    table: tasks,
    metadata: {
      name: 'tasks',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'contacts', 'deals'],
      description: 'Task management',
      isCore: false,
      indexes: ['idx_tasks_tenant', 'idx_tasks_assigned', 'idx_tasks_due', 'idx_tasks_metadata_g', 'idx_tasks_active'],
    },
  },
  tenantBackups: {
    table: tenantBackups,
    metadata: {
      name: 'tenant_backups',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Tenant data backups',
      isCore: false,
      indexes: ['idx_tenant_backups_tenant', 'idx_tenant_backups_metadata_g'],
    },
  },
  tenantRestores: {
    table: tenantRestores,
    metadata: {
      name: 'tenant_restores',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'tenantBackups', 'users'],
      description: 'Tenant data restores',
      isCore: false,
      indexes: ['idx_tenant_restores_tenant', 'idx_tenant_restores_metadata_g'],
    },
  },
  dashboards: {
    table: dashboards,
    metadata: {
      name: 'dashboards',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Custom dashboards',
      isCore: false,
      indexes: ['idx_dashboards_tenant', 'idx_dashboards_active'],
    },
  },
  savedReports: {
    table: savedReports,
    metadata: {
      name: 'saved_reports',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Custom saved reports',
      isCore: false,
      indexes: ['idx_saved_reports_tenant'],
    },
  },
  billingEvents: {
    table: billingEvents,
    metadata: {
      name: 'billing_events',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Stripe billing events',
      isCore: false,
      indexes: ['idx_billing_events_tenant', 'idx_billing_events_type', 'idx_billing_events_stripe_event', 'idx_billing_events_metadata_g'],
    },
  },
  usageSnapshots: {
    table: usageSnapshots,
    metadata: {
      name: 'usage_snapshots',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Usage tracking snapshots',
      isCore: false,
      indexes: ['idx_usage_snapshots_tenant_date', 'idx_usage_snapshots_date', 'idx_usage_snapshots_tenant', 'idx_usage_snapshots_metadata_g'],
    },
  },
  limitViolations: {
    table: limitViolations,
    metadata: {
      name: 'limit_violations',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Plan limit violation logs',
      isCore: false,
      indexes: ['idx_limit_violations_tenant', 'idx_limit_violations_unresolved'],
    },
  },
  fileUploads: {
    table: fileUploads,
    metadata: {
      name: 'file_uploads',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'File upload registry',
      isCore: false,
      indexes: ['idx_file_uploads_entity', 'idx_file_uploads_tenant', 'idx_file_uploads_active'],
    },
  },
  announcements: {
    table: announcements,
    metadata: {
      name: 'announcements',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: [],
      description: 'System-wide announcements',
      isCore: true,
      indexes: ['idx_announcements_active'],
    },
  },
  tenantBackupRecords: {
    table: tenantBackupRecords,
    metadata: {
      name: 'tenant_backup_records',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Per-tenant data backup records',
      isCore: true,
      indexes: ['idx_tenant_backup_tenant', 'idx_tenant_backup_status', 'idx_tenant_backup_expires'],
    },
  },
  tenantRestoreRecords: {
    table: tenantRestoreRecords,
    metadata: {
      name: 'tenant_restore_records',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenantBackupRecords'],
      description: 'Per-tenant data restore records',
      isCore: true,
      indexes: ['idx_tenant_restore_tenant', 'idx_tenant_restore_backup'],
    },
  },
  backupAlerts: {
    table: backupAlerts,
    metadata: {
      name: 'backup_alerts',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'System backup alerts',
      isCore: true,
      indexes: ['idx_backup_alerts_unresolved'],
    },
  },
  backupSchedules: {
    table: backupSchedules,
    metadata: {
      name: 'backup_schedules',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Backup schedule config',
      isCore: false,
      indexes: ['idx_backup_schedules_tenant'],
    },
  },
  criticalDataBackups: {
    table: criticalDataBackups,
    metadata: {
      name: 'critical_data_backups',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Point-in-time critical data backups',
      isCore: false,
      indexes: ['idx_critical_backups_tenant', 'idx_critical_backups_retain', 'idx_critical_backups_record', 'idx_critical_backups_can_restore'],
    },
  },
  permissionOverrides: {
    table: permissionOverrides,
    metadata: {
      name: 'permission_overrides',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'roles'],
      description: 'Individual permission overrides',
      isCore: false,
      indexes: ['idx_permission_overrides_tenant', 'idx_permission_overrides_role', 'idx_permission_overrides_entity'],
    },
  },
  healthChecks: {
    table: healthChecks,
    metadata: {
      name: 'health_checks',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'System health monitoring',
      isCore: true,
      indexes: ['idx_health_checks_service'],
    },
  },
  onboardingProgress: {
    table: onboardingProgress,
    metadata: {
      name: 'onboarding_progress',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'User onboarding tracking',
      isCore: false,
      indexes: ['idx_onboarding_tenant_user', 'idx_onboarding_step', 'idx_onboarding_progress_tenant'],
    },
  },
  platformSettings: {
    table: platformSettings,
    metadata: {
      name: 'platform_settings',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tenant platform config',
      isCore: false,
      indexes: ['idx_platform_settings_key', 'idx_platform_settings_tenant'],
    },
  },
  reportExecutions: {
    table: reportExecutions,
    metadata: {
      name: 'report_executions',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Report execution history',
      isCore: false,
      indexes: ['idx_report_executions_tenant', 'idx_report_executions_metadata_g'],
    },
  },
  revenueForecastSummary: {
    table: revenueForecastSummary,
    metadata: {
      name: 'revenue_forecast_summary',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Aggregated revenue forecasts',
      isCore: false,
      indexes: ['idx_revenue_forecast_tenant_date', 'idx_revenue_forecast_summary_tenant'],
    },
  },
  selectiveRestoreAuditLog: {
    table: selectiveRestoreAuditLog,
    metadata: {
      name: 'selective_restore_audit_log',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Audit log for restore ops',
      isCore: false,
      indexes: ['idx_selective_restore_audit_log_tenant'],
    },
  },
  selectiveRestoreLogs: {
    table: selectiveRestoreLogs,
    metadata: {
      name: 'selective_restore_logs',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Technical logs for restores',
      isCore: false,
      indexes: ['idx_selective_restore_logs_tenant'],
    },
  },
  superAdminBackups: {
    table: superAdminBackups,
    metadata: {
      name: 'super_admin_backups',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Full system backups',
      isCore: true,
      indexes: ['idx_super_admin_backups_name', 'idx_super_admin_backups_status'],
    },
  },
  userDepartures: {
    table: userDepartures,
    metadata: {
      name: 'user_departures',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Offboarding tracking',
      isCore: false,
      indexes: ['idx_user_departures_tenant', 'idx_user_departures_user', 'idx_user_departures_date'],
    },
  },
  apiKeyUsageInfra: {
    table: apiKeyUsageInfra,
    metadata: {
      name: 'api_key_usage_infra',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Infra-level API tracking',
      isCore: false,
      indexes: ['idx_api_key_usage_key', 'idx_api_key_usage_infra_tenant'],
    },
  },
  dashboardTemplates: {
    table: dashboardTemplates,
    metadata: {
      name: 'dashboard_templates',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Prebuilt dashboard templates',
      isCore: true,
      indexes: ['idx_dashboard_templates_active'],
    },
  },
  reportTemplates: {
    table: reportTemplates,
    metadata: {
      name: 'report_templates',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Prebuilt report templates',
      isCore: true,
      indexes: ['idx_report_templates_active'],
    },
  },
  ssoProviders: {
    table: ssoProviders,
    metadata: {
      name: 'sso_providers',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'SSO provider config',
      isCore: false,
      indexes: ['idx_sso_providers_tenant', 'idx_sso_providers_active'],
    },
  },
  ssoSessions: {
    table: ssoSessions,
    metadata: {
      name: 'sso_sessions',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users', 'ssoProviders'],
      description: 'Active SSO sessions',
      isCore: false,
      indexes: ['idx_sso_sessions_user', 'idx_sso_sessions_id', 'idx_sso_sessions_tenant'],
    },
  },

  backupRecords: {
    table: backupRecords,
    metadata: {
      name: 'backup_records',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: [],
      description: 'System backup operation records',
      isCore: false,
      indexes: ['idx_backup_records_status'],
    },
  },
  restoreSnapshots: {
    table: restoreSnapshots,
    metadata: {
      name: 'restore_snapshots',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Point-in-time restore snapshots',
      isCore: false,
      indexes: ['idx_restore_snapshots_tenant'],
    },
  },
  complianceRequests: {
    table: complianceRequests,
    metadata: {
      name: 'compliance_requests',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'GDPR/SOC2 compliance request records',
      isCore: false,
      indexes: ['idx_compliance_requests_tenant', 'idx_compliance_requests_type', 'idx_compliance_requests_status'],
    },
  },
  dataRetentionPolicies: {
    table: dataRetentionPolicies,
    metadata: {
      name: 'data_retention_policies',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Data retention and archival policy configurations',
      isCore: false,
      indexes: ['idx_data_retention_tenant', 'idx_data_retention_entity'],
    },
  },
  dashboardLayouts: {
    table: dashboardLayouts,
    metadata: {
      name: 'dashboard_layouts',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'User dashboard layout configurations',
      isCore: false,
      indexes: ['idx_dashboard_layouts_tenant', 'idx_dashboard_layouts_user_default'],
    },
  },
  tenantHierarchy: {
    table: tenantHierarchy,
    metadata: {
      name: 'tenant_hierarchy',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Multi-tenant parent-child relationship records',
      isCore: false,
      indexes: [],
    },
  },
  hierarchyPermissions: {
    table: hierarchyPermissions,
    metadata: {
      name: 'hierarchy_permissions',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenantHierarchy'],
      description: 'Hierarchy-level permission assignments',
      isCore: false,
      indexes: [],
    },
  },
  userUsage: {
    table: userUsage,
    metadata: {
      name: 'user_usage',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Per-user resource usage tracking',
      isCore: false,
      indexes: ['idx_user_usage_unique', 'idx_user_usage_tenant'],
    },
  },
  planLimits: {
    table: planLimits,
    metadata: {
      name: 'plan_limits',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Subscription plan resource limit definitions',
      isCore: false,
      indexes: [],
    },
  },

  // Marketing tables
  sequences: {
    table: sequences,
    metadata: {
      name: 'sequences',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Email sequences',
      isCore: false,
      indexes: ['idx_sequences_tenant', 'idx_sequences_metadata_g', 'idx_sequences_active'],
    },
  },
  sequenceSteps: {
    table: sequenceSteps,
    metadata: {
      name: 'sequence_steps',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['sequences', 'tenants'],
      description: 'Steps in a sequence',
      isCore: false,
      indexes: ['idx_sequence_steps_seq', 'idx_sequence_steps_tenant'],
    },
  },
  sequenceStepLogs: {
    table: sequenceStepLogs,
    metadata: {
      name: 'sequence_step_logs',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['sequenceEnrollments', 'sequenceSteps', 'tenants'],
      description: 'Sequence execution logs',
      isCore: false,
      indexes: ['idx_sequence_step_logs_enrollment', 'idx_sequence_step_logs_scheduled', 'idx_sequence_step_logs_tenant'],
    },
  },
  sequenceEnrollments: {
    table: sequenceEnrollments,
    metadata: {
      name: 'sequence_enrollments',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'sequences', 'contacts', 'users'],
      description: 'Contact enrollments in sequences',
      isCore: false,
      indexes: ['idx_sequence_enrollments_tenant', 'idx_seq_enroll_contact', 'idx_seq_enroll_seq', 'idx_seq_enroll_status', 'idx_sequence_enrollments_metadata_g'],
    },
  },

  leadWarmingEvents: {
    table: leadWarmingEvents,
    metadata: {
      name: 'lead_warming_events',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Lead warming event/festival calendar entries',
      isCore: false,
      indexes: ['idx_lead_warming_events_tenant', 'idx_lead_warming_events_type', 'idx_lead_warming_events_month_day', 'idx_lead_warming_events_active'],
    },
  },
  leadWarmingCampaigns: {
    table: leadWarmingCampaigns,
    metadata: {
      name: 'lead_warming_campaigns',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Lead warming campaign configurations',
      isCore: false,
      indexes: ['idx_lead_warming_campaigns_tenant', 'idx_lead_warming_campaigns_status', 'idx_lead_warming_campaigns_active'],
    },
  },
  leadWarmingMessages: {
    table: leadWarmingMessages,
    metadata: {
      name: 'lead_warming_messages',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns', 'leadWarmingEvents'],
      description: 'Sent lead warming message log',
      isCore: false,
      indexes: ['idx_lead_warming_msg_campaign', 'idx_lead_warming_msg_contact', 'idx_lead_warming_msg_status', 'idx_lead_warming_msg_channel'],
    },
  },
  leadWarmingReplies: {
    table: leadWarmingReplies,
    metadata: {
      name: 'lead_warming_replies',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns', 'leadWarmingMessages'],
      description: 'AI-analyzed lead warming reply records',
      isCore: false,
      indexes: ['idx_lead_warming_replies_message', 'idx_lead_warming_replies_contact', 'idx_lead_warming_replies_intent', 'idx_lead_warming_replies_unanalyzed', 'idx_lead_warming_replies_positive'],
    },
  },
  leadWarmingSchedule: {
    table: leadWarmingSchedule,
    metadata: {
      name: 'lead_warming_schedule',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns'],
      description: 'Per-contact lead warming sending schedule',
      isCore: false,
      indexes: ['idx_lead_warming_sched_unique', 'idx_lead_warming_sched_tenant', 'idx_lead_warming_sched_eligible'],
    },
  },

  // Support tables
  errorLogs: {
    table: errorLogs,
    metadata: {
      name: 'error_logs',
      schemaGroup: 'support',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Centralized error tracking',
      isCore: true,
      indexes: ['idx_error_logs_tenant', 'idx_error_logs_user', 'idx_error_logs_level', 'idx_error_logs_resolved', 'idx_error_logs_created'],
    },
  },
  webhookQueue: {
    table: webhookQueue,
    metadata: {
      name: 'webhook_queue',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['webhooks'],
      description: 'Queued webhook deliveries with retry logic',
      isCore: false,
      indexes: ['idx_webhook_queue_webhook_id', 'idx_webhook_queue_status', 'idx_webhook_queue_next_retry'],
    },
  },
  failedWebhooks: {
    table: failedWebhooks,
    metadata: {
      name: 'failed_webhooks',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Failed webhook attempts',
      isCore: false,
      indexes: ['idx_failed_webhooks_tenant', 'idx_failed_webhooks_webhook'],
    },
  },
  supportTickets: {
    table: supportTickets,
    metadata: {
      name: 'support_tickets',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'users'],
      description: 'Customer support tickets',
      isCore: false,
      indexes: ['idx_support_tickets_tenant', 'idx_tickets_contact', 'idx_tickets_status', 'idx_support_tickets_metadata_g', 'idx_support_tickets_active'],
    },
  },
  ticketReplies: {
    table: ticketReplies,
    metadata: {
      name: 'ticket_replies',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['supportTickets', 'tenants', 'users', 'contacts'],
      description: 'Replies to support tickets',
      isCore: false,
      indexes: ['idx_ticket_replies_tenant', 'idx_ticket_replies_ticket'],
    },
  },

  slaPolicies: {
    table: slaPolicies,
    metadata: {
      name: 'sla_policies',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'SLA policy definitions for support',
      isCore: false,
      indexes: ['idx_sla_policies_tenant', 'idx_sla_policies_priority', 'idx_sla_policies_active'],
    },
  },
  slaBreaches: {
    table: slaBreaches,
    metadata: {
      name: 'sla_breaches',
      schemaGroup: 'support',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'SLA breach event records',
      isCore: false,
      indexes: ['idx_sla_breaches_tenant', 'idx_sla_breaches_policy', 'idx_sla_breaches_entity'],
    },
  },

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

  // Modules tables
  modules: {
    table: modules,
    metadata: {
      name: 'modules',
      schemaGroup: 'modules',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Module registry',
      isCore: true,
      indexes: [],
    },
  },
  tenantModules: {
    table: tenantModules,
    metadata: {
      name: 'tenant_modules',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'modules', 'users'],
      description: 'Tenant module installations',
      isCore: false,
      indexes: ['idx_tenant_modules_unique', 'idx_tenant_modules_tenant'],
    },
  },
  customPlugins: {
    table: customPlugins,
    metadata: {
      name: 'custom_plugins',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Custom user-defined API plugins',
      isCore: false,
      indexes: ['idx_custom_plugins_tenant', 'idx_custom_plugins_user', 'idx_custom_plugins_status', 'idx_custom_plugins_metadata_g', 'idx_custom_plugins_active'],
    },
  },
  pluginExecutionLogs: {
    table: pluginExecutionLogs,
    metadata: {
      name: 'plugin_execution_logs',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'customPlugins'],
      description: 'Plugin action execution logs',
      isCore: false,
      indexes: ['idx_plugin_execution_logs_tenant', 'idx_plugin_execution_logs_plugin', 'idx_plugin_execution_logs_success'],
    },
  },

  // Segments tables
  segments: {
    table: segments,
    metadata: {
      name: 'segments',
      schemaGroup: 'segments',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Dynamic contact segments',
      isCore: false,
      indexes: ['idx_segments_tenant', 'idx_segments_metadata_g'],
    },
  },
  segmentMembers: {
    table: segmentMembers,
    metadata: {
      name: 'segment_members',
      schemaGroup: 'segments',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['segments', 'contacts', 'tenants'],
      description: 'Membership of contacts in segments',
      isCore: false,
      indexes: ['idx_segment_members_segment', 'idx_segment_members_contact', 'idx_segment_members_tenant'],
    },
  },

  // Knowledge Base tables
  kbCategories: {
    table: kbCategories,
    metadata: {
      name: 'kb_categories',
      schemaGroup: 'knowledge',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Knowledge base categories',
      isCore: false,
      indexes: ['idx_kb_categories_tenant', 'idx_kb_categories_slug', 'idx_kb_categories_active'],
    },
  },
  kbArticles: {
    table: kbArticles,
    metadata: {
      name: 'kb_articles',
      schemaGroup: 'knowledge',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'kbCategories'],
      description: 'Knowledge base articles',
      isCore: false,
      indexes: ['idx_kb_articles_tenant', 'idx_kb_articles_category', 'idx_kb_articles_status', 'idx_kb_articles_slug', 'idx_kb_articles_search', 'idx_kb_articles_active', 'idx_kb_articles_metadata_g'],
    },
  },
  // Security tables
  loginAttempts: {
    table: loginAttempts,
    metadata: {
      name: 'login_attempts',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Login attempt records for brute force protection',
      isCore: false,
      indexes: ['idx_login_attempts_email', 'idx_login_attempts_ip', 'idx_login_attempts_time'],
    },
  },
  loginBlocks: {
    table: loginBlocks,
    metadata: {
      name: 'login_blocks',
      schemaGroup: 'infra',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'IP/email blocks for brute force protection',
      isCore: false,
      indexes: ['idx_login_blocks_identifier_type', 'idx_login_blocks_until'],
    },
  },
  securityEvents: {
    table: securityEvents,
    metadata: {
      name: 'security_events',
      schemaGroup: 'infra',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Security event audit trail',
      isCore: false,
      indexes: ['idx_security_events_tenant', 'idx_security_events_user', 'idx_security_events_type', 'idx_security_events_time'],
    },
  },
  // Billing tables
  services: {
    table: services,
    metadata: {
      name: 'services',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Billable services',
      isCore: false,
      indexes: [],
    },
  },
  serviceCategories: {
    table: serviceCategories,
    metadata: {
      name: 'service_categories',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Service categories',
      isCore: false,
      indexes: [],
    },
  },
  invoices: {
    table: invoices,
    metadata: {
      name: 'invoices',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer invoices',
      isCore: false,
      indexes: [],
    },
  },
  invoiceLineItems: {
    table: invoiceLineItems,
    metadata: {
      name: 'invoice_line_items',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['invoices'],
      description: 'Invoice line items',
      isCore: false,
      indexes: [],
    },
  },
  invoicePayments: {
    table: invoicePayments,
    metadata: {
      name: 'invoice_payments',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'invoices'],
      description: 'Invoice payment records',
      isCore: false,
      indexes: [],
    },
  },
  orders: {
    table: orders,
    metadata: {
      name: 'orders',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer orders',
      isCore: false,
      indexes: [],
    },
  },
  orderLineItems: {
    table: orderLineItems,
    metadata: {
      name: 'order_line_items',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['orders'],
      description: 'Order line items',
      isCore: false,
      indexes: [],
    },
  },
  contracts: {
    table: contracts,
    metadata: {
      name: 'contracts',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer contracts',
      isCore: false,
      indexes: [],
    },
  },
  serviceSubscriptions: {
    table: serviceSubscriptions,
    metadata: {
      name: 'service_subscriptions',

      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'services'],
      description: 'Service subscriptions',
      isCore: false,
      indexes: [],
    },
  },
  exchangeRates: {
    table: exchangeRates,
    metadata: {
      name: 'exchange_rates',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Currency exchange rate records',
      isCore: false,
      indexes: ['idx_exchange_rates_pair', 'idx_exchange_rates_fetched'],
    },
  },
  taxRates: {
    table: taxRates,
    metadata: {
      name: 'tax_rates',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tax rate configurations per region',
      isCore: false,
      indexes: ['idx_tax_rates_tenant', 'idx_tax_rates_region', 'idx_tax_rates_active'],
    },
  },
  taxExemptions: {
    table: taxExemptions,
    metadata: {
      name: 'tax_exemptions',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tax exemption records for entities',
      isCore: false,
      indexes: ['idx_tax_exemptions_tenant', 'idx_tax_exemptions_entity'],
    },
  },

  // History tables
  editHistory: {
    table: editHistory,
    metadata: {
      name: 'edit_history',
      schemaGroup: 'history',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Edit history for all entity types',
      isCore: false,
      indexes: [],
    },
  },
  fieldSnapshots: {
    table: fieldSnapshots,
    metadata: {
      name: 'field_snapshots',
      schemaGroup: 'history',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'editHistory'],
      description: 'Field-level snapshots for edit history',
      isCore: false,
      indexes: [],
    },
  },
  // Product template tables
  productTemplates: {
    table: productTemplates,
    metadata: {
      name: 'product_templates',
      schemaGroup: 'modules',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'Product template definitions for onboarding',
      isCore: false,
      indexes: ['idx_product_templates_slug', 'idx_product_templates_status'],
    },
  },
  tenantTemplates: {
    table: tenantTemplates,
    metadata: {
      name: 'tenant_templates',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'productTemplates', 'users'],
      description: 'Template assignments to tenants',
      isCore: false,
      indexes: ['idx_tenant_templates_unique'],
    },
  },
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

  // Document Management tables
  documentFolders: {
    table: documentFolders,
    metadata: {
      name: 'document_folders',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Hierarchical document folder structure',
      isCore: false,
      indexes: ['idx_document_folders_tenant', 'idx_document_folders_parent'],
    },
  },
  documentRecords: {
    table: documentRecords,
    metadata: {
      name: 'documents',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Document metadata records with folder organization',
      isCore: false,
      indexes: ['idx_documents_tenant', 'idx_documents_folder', 'idx_documents_entity', 'idx_documents_uploader'],
    },
  },
  storageDocuments: {
    table: storageDocuments,
    metadata: {
      name: 'documents',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Workspace file attachments in object storage',
      isCore: false,
      indexes: ['idx_documents_tenant', 'idx_documents_active', 'idx_documents_metadata_g', 'idx_documents_link', 'idx_documents_uploader'],
    },
  },

  // Electronic Signature tables
  signingRequests: {
    table: signingRequests,
    metadata: {
      name: 'signing_requests',
      schemaGroup: 'esignature',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Electronic signature requests',
      isCore: false,
      indexes: ['idx_signing_requests_tenant', 'idx_signing_requests_document', 'idx_signing_requests_status', 'idx_signing_requests_external'],
    },
  },
  signingEvents: {
    table: signingEvents,
    metadata: {
      name: 'signing_events',
      schemaGroup: 'esignature',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'signingRequests'],
      description: 'Signature event audit trail',
      isCore: false,
      indexes: ['idx_signing_events_request', 'idx_signing_events_tenant', 'idx_signing_events_signer'],
    },
  },

  // Project Management tables
  projects: {
    table: projects,
    metadata: {
      name: 'projects',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Project records',
      isCore: false,
      indexes: ['idx_projects_tenant', 'idx_projects_status', 'idx_projects_owner', 'idx_projects_active'],
    },
  },
  milestones: {
    table: milestones,
    metadata: {
      name: 'milestones',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'projects'],
      description: 'Project milestone tracking',
      isCore: false,
      indexes: ['idx_milestones_tenant', 'idx_milestones_project'],
    },
  },
  projectTasks: {
    table: projectTasks,
    metadata: {
      name: 'project_tasks',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'projects', 'tasks'],
      description: 'Junction table linking projects to tasks',
      isCore: false,
      indexes: ['idx_project_tasks_unique', 'idx_project_tasks_tenant'],
    },
  },
};

// =============================================================================
// SCHEMA GROUP ACCESS
// =============================================================================

/**
 * Get all tables in a specific schema group.
 * Useful for module-based migrations and validations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTablesByGroup(group: SchemaGroup): Record<string, any> {
  return Object.fromEntries(
    Object.entries(TABLE_REGISTRY)
      .filter(([_, entry]) => entry.metadata.schemaGroup === group)
      .map(([name, entry]) => [name, entry.table])
  );
}

/**
 * Get all table names in a specific schema group.
 */
export function getTableNamesByGroup(group: SchemaGroup): string[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.schemaGroup === group)
    .map(([name]) => name);
}

// =============================================================================
// DEPLOYMENT UTILITIES
// =============================================================================

/**
 * Get tables sorted by dependency order (dependencies first).
 * Useful for creating tables in the correct order during migration.
 */
export function getTablesInDependencyOrder(): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(tableName: string): void {
    if (visited.has(tableName)) return;
    
    const entry = TABLE_REGISTRY[tableName as keyof typeof TABLE_REGISTRY];
    if (!entry) return;

    // Visit dependencies first
    for (const dep of entry.metadata.dependencies) {
      if (dep in TABLE_REGISTRY) {
        visit(dep);
      }
    }

    visited.add(tableName);
    result.push(tableName);
  }

  // Visit all tables
  for (const tableName of Object.keys(TABLE_REGISTRY)) {
    visit(tableName);
  }

  return result;
}

/**
 * Get all tables that have a specific feature.
 */
export function getTablesWithFeature(feature: keyof TableMetadata): string[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata[feature])
    .map(([name]) => name);
}

/**
 * Check if a table exists in the registry.
 */
export function tableExists(tableName: string): tableName is TableName {
  return tableName in TABLE_REGISTRY;
}

/**
 * Get metadata for a specific table.
 */
export function getTableMetadata(tableName: TableName): TableMetadata {
  const entry = TABLE_REGISTRY[tableName];
  if (!entry) {
    throw new Error(`Table '${tableName}' not found in registry`);
  }
  return entry.metadata as TableMetadata;
}

/**
 * Get all table names as an array.
 */
export function getAllTableNames(): TableName[] {
  return Object.keys(TABLE_REGISTRY) as TableName[];
}

/**
 * Get all core tables (required for basic functionality).
 */
export function getCoreTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.isCore)
    .map(([name]) => name) as TableName[];
}

/**
 * Get all tenant-scoped tables.
 */
export function getTenantTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.hasTenantId)
    .map(([name]) => name) as TableName[];
}

/**
 * Get all tables with soft delete support.
 */
export function getSoftDeleteTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.hasSoftDelete)
    .map(([name]) => name) as TableName[];
}

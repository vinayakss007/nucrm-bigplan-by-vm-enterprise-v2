/**
 * Table registry entries for the `support` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  errorLogs,
  webhookQueue,
  failedWebhooks,
  supportTickets,
  ticketReplies,
} from '../support';
import {
  slaPolicies,
  slaBreaches,
} from '../sla';

export const SUPPORT_TABLES = {

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
};

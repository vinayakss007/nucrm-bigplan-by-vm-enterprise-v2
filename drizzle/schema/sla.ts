/**
 * NuCRM - SLA Management Schema
 *
 * Tables for SLA policies and breach tracking for the helpdesk module.
 */

import { pgTable, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── SLA POLICIES ─────────────────────────────────────────
export const slaPolicies = pgTable('sla_policies', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  priority: text('priority').notNull(), // 'critical' | 'high' | 'medium' | 'low'
  responseTimeMinutes: integer('response_time_minutes').notNull(),
  resolutionTimeMinutes: integer('resolution_time_minutes').notNull(),
  escalationRules: jsonb('escalation_rules').default([]),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_sla_policies_tenant').on(table.tenantId),
    priorityIdx: index('idx_sla_policies_priority').on(table.tenantId, table.priority),
    activeIdx: index('idx_sla_policies_active').on(table.tenantId, table.isActive),
  };
});

// ── SLA BREACHES ─────────────────────────────────────────
export const slaBreaches = pgTable('sla_breaches', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  policyId: text('policy_id').notNull(),
  entityType: text('entity_type').notNull(), // 'ticket' | 'deal' | 'task'
  entityId: text('entity_id').notNull(),
  breachType: text('breach_type').notNull(), // 'response' | 'resolution'
  breachedAt: timestamp('breached_at', { withTimezone: true }).notNull(),
  notifiedUsers: jsonb('notified_users').default([]),
  escalationLevel: integer('escalation_level').default(0),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_sla_breaches_tenant').on(table.tenantId),
    policyIdx: index('idx_sla_breaches_policy').on(table.tenantId, table.policyId),
    entityIdx: index('idx_sla_breaches_entity').on(table.tenantId, table.entityType, table.entityId),
  };
});

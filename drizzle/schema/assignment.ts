/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM - Auto-Assignment Schema
 *
 * Tables for assignment rules and assignment audit logs.
 */

import { pgTable, text, uuid, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── ASSIGNMENT RULES ─────────────────────────────────────
export const assignmentRules = pgTable('assignment_rules', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'round_robin' | 'territory' | 'skill_based' | 'weighted'
  config: jsonb('config').default({}),
  isActive: boolean('is_active').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  entityType: text('entity_type').notNull().default('lead'), // 'lead' | 'ticket' | 'deal'
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_assignment_rules_tenant').on(table.tenantId),
    typeIdx: index('idx_assignment_rules_type').on(table.tenantId, table.type),
    activeIdx: index('idx_assignment_rules_active').on(table.tenantId, table.isActive),
  };
});

// ── ASSIGNMENT LOGS ──────────────────────────────────────
export const assignmentLogs = pgTable('assignment_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  ruleId: uuid('rule_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  assignedTo: uuid('assigned_to').notNull(),
  reason: text('reason'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_assignment_logs_tenant').on(table.tenantId),
    ruleIdx: index('idx_assignment_logs_rule').on(table.tenantId, table.ruleId),
    entityIdx: index('idx_assignment_logs_entity').on(table.tenantId, table.entityType, table.entityId),
    assigneeIdx: index('idx_assignment_logs_assignee').on(table.tenantId, table.assignedTo),
  };
});

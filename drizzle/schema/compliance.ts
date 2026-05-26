/**
 * NuCRM - Compliance Schema
 * 
 * Tables for GDPR compliance requests, SOC 2 report tracking,
 * and data retention policy management.
 */

import { pgTable, uuid, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── COMPLIANCE REQUESTS ──────────────────────────────────
export const complianceRequests = pgTable('compliance_requests', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  type: text('type').notNull(), // 'gdpr_export' | 'gdpr_delete' | 'soc2_report'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  requestedBy: uuid('requested_by').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  result: jsonb('result').default({}),
  errorMessage: text('error_message'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    typeIdx: index('idx_compliance_requests_type').on(table.tenantId, table.type),
    statusIdx: index('idx_compliance_requests_status').on(table.tenantId, table.status),
  };
});

// ── DATA RETENTION POLICIES ──────────────────────────────
export const dataRetentionPolicies = pgTable('data_retention_policies', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(), // 'contacts' | 'deals' | 'activities' | 'emails' | 'audit_logs'
  retentionDays: integer('retention_days').notNull(),
  action: text('action').notNull().default('archive'), // 'archive' | 'delete' | 'anonymize'
  isActive: boolean('is_active').notNull().default(true),
  lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_data_retention_entity').on(table.tenantId, table.entityType),
  };
});

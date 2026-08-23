/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { pgTable, text, timestamp, index, uuid, jsonb } from 'drizzle-orm/pg-core';

export const superAdminAuditLogs = pgTable('super_admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').notNull(),
  adminEmail: text('admin_email').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  targetName: text('target_name'),
  tenantId: uuid('tenant_id'),
  tenantName: text('tenant_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  oldData: jsonb('old_data'),
  newData: jsonb('new_data'),
  metadata: jsonb('metadata'),
  previousHash: text('previous_hash'),
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  adminIdx: index('idx_super_admin_audit_admin').on(table.adminId, table.createdAt),
  actionIdx: index('idx_super_admin_audit_action').on(table.action, table.createdAt),
  tenantIdx: index('idx_super_admin_audit_tenant').on(table.tenantId, table.createdAt),
  timeIdx: index('idx_super_admin_audit_time').on(table.createdAt),
}));

export type SuperAdminAuditLog = typeof superAdminAuditLogs.$inferSelect;
export type NewSuperAdminAuditLog = typeof superAdminAuditLogs.$inferInsert;

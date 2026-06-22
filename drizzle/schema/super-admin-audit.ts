import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

export const superAdminAuditLogs = pgTable('super_admin_audit_logs', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull(),
  adminEmail: text('admin_email').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  targetName: text('target_name'),
  tenantId: text('tenant_id'),
  tenantName: text('tenant_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  oldData: text('old_data'),
  newData: text('new_data'),
  metadata: text('metadata'),
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

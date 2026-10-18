/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { pgTable, text, timestamp, index, uuid } from 'drizzle-orm/pg-core';

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
  // #2510, disposition (2) — the database is the truth, not these lines:
  // 0002_flat_sir_ram.sql:1289-1291 built all three as text, and
  // 0007_super_admin_audit_logs.sql's jsonb re-declaration is an inert
  // `CREATE TABLE IF NOT EXISTS` that never executed anywhere (chain build
  // AND pre-prod measured text). lib/audit/super-admin.ts writes
  // JSON.stringify and reads `string | null` end to end, and 0057's CHECKs
  // pattern-match text. Declaring jsonb here only armed `db:sync`
  // (drizzle-kit push) to re-type a security audit table as a side effect —
  // the hazard that made #2510 choose text over migrating to jsonb.
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

  drz2255_idx_sa_audit_action: index('idx_sa_audit_action').on(table.action),
  drz2255_idx_sa_audit_time: index('idx_sa_audit_time').on(table.createdAt.desc()),
  drz2255_idx_sa_audit_admin: index('idx_sa_audit_admin').on(table.adminId),
  drz2255_idx_sa_audit_admin_time: index('idx_sa_audit_admin_time').on(table.adminId, table.createdAt.desc()),
  drz2255_idx_sa_audit_target: index('idx_sa_audit_target').on(table.targetType, table.targetId),
  drz2255_idx_sa_audit_tenant: index('idx_sa_audit_tenant').on(table.tenantId),}));

export type SuperAdminAuditLog = typeof superAdminAuditLogs.$inferSelect;
export type NewSuperAdminAuditLog = typeof superAdminAuditLogs.$inferInsert;

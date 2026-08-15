import { pgTable, uuid, text, jsonb, timestamp, boolean, integer, index, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import * as utils from './utils';

export { activities } from './activity';
export { onboardingProgress } from './core';
export { ssoProviders, ssoSessions } from './security';

// ── 1. SYSTEM SETTINGS ────────────────────────────────
export const systemSettings = pgTable('system_settings', {
  id: utils.pk(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  ...utils.lifecycle(),
});

// ── 2. BACKUP & RESTORE ───────────────────────────────
export const tenantBackups = pgTable('tenant_backups', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  filename: text('filename').notNull(),
  storagePath: text('storage_path').notNull(),
  sizeBytes: integer('size_bytes'),
  
  status: text('status').notNull().default('pending'), // 'pending', 'completed', 'failed'
  backupType: text('backup_type').notNull().default('automated'), // 'automated', 'manual', 'pre-deletion'
  
  metadata: utils.metadata(),
  
  ...utils.lifecycle(),
  expiresAt: timestamp('expires_at', { withTimezone: true }), // 90-day retention
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const tenantRestores = pgTable('tenant_restores', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  backupId: uuid('backup_id').references(() => tenantBackups.id),
  
  status: text('status').notNull().default('pending'),
  initiatedBy: uuid('initiated_by').references(() => users.id),
  
  metadata: utils.metadata(),
  
  ...utils.lifecycle(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 3. ANALYTICS & DASHBOARDS ─────────────────────────
export const dashboards = pgTable('dashboards', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  layout: jsonb('layout').default([]), // Widget positions
  isDefault: boolean('is_default').default(false),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const savedReports = pgTable('saved_reports', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  reportType: text('report_type').notNull(),
  config: jsonb('config').notNull(), // Filters, columns, etc.
  chartType: text('chart_type').default('table'),
  isPublic: boolean('is_public').default(false),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 4. ANNOUNCEMENTS ─────────────────────────────────
export const announcements = pgTable('announcements', {
  id: utils.pk(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: text('type').default('info'), // 'info', 'warning', 'update', 'feature'
  target: text('target').default('all'), // 'all', 'tenants', 'super_admins'
  targetTenantIds: uuid('target_tenant_ids').array(),
  isActive: boolean('is_active').default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  ...utils.audit(),
}, (table) => {
  return {
    activeTimeIdx: index('idx_announcements_active_time').on(table.isActive, table.startsAt, table.endsAt),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 5. TENANT BACKUP RECORDS ────────────────────────
export const tenantBackupRecords = pgTable('tenant_backup_records', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  status: text('status').notNull().default('pending'), // 'pending', 'running', 'completed', 'failed'
  backupType: text('backup_type').default('full'), // 'full', 'critical_only'
  dataSize: bigint('data_size', { mode: 'number' }).default(0),
  tableCount: integer('table_count').default(0),
  recordCount: bigint('record_count', { mode: 'number' }).default(0),
  backupData: jsonb('backup_data'), // The actual data
  backupNote: text('backup_note'),
  includeTables: jsonb('include_tables'),
  initiatedBy: uuid('initiated_by').references(() => users.id),
  initiatedAuto: boolean('initiated_auto').default(false),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  retentionDays: integer('retention_days').default(90),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...utils.lifecycle(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: index('idx_tenant_backup_tenant').on(table.tenantId, table.status),
    statusIdx: index('idx_tenant_backup_status').on(table.status, table.createdAt),
    expiresIdx: index('idx_tenant_backup_expires').on(table.expiresAt).where(sql`status = 'completed'`),
  };
});

// ── 6. TENANT RESTORE RECORDS ────────────────────────
export const tenantRestoreRecords = pgTable('tenant_restore_records', {
  id: utils.pk(),
  backupId: uuid('backup_id').notNull().references(() => tenantBackupRecords.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  status: text('status').notNull().default('running'), // 'running', 'completed', 'failed'
  restoreOptions: jsonb('restore_options'), // { deleteExisting, skipTables }
  tablesRestored: integer('tables_restored').default(0),
  recordsRestored: bigint('records_restored', { mode: 'number' }).default(0),
  initiatedBy: uuid('initiated_by').references(() => users.id),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: index('idx_tenant_restore_tenant').on(table.tenantId, table.status),
    backupIdx: index('idx_tenant_restore_backup').on(table.backupId),
  };
});

// ── 7. BACKUP ALERTS ────────────────────────────────
export const backupAlerts = pgTable('backup_alerts', {
  id: utils.pk(),
  alertType: text('alert_type').notNull(),
  message: text('message').notNull(),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    unresolvedIdx: index('idx_backup_alerts_unresolved').on(table.resolved, table.createdAt).where(sql`resolved = false`),
  };
});

export const backupRecords = pgTable('backup_records', {
  id: utils.pk(),
  backupType: text('backup_type').notNull().default('full'),
  status: text('status').notNull().default('pending'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0),
  storagePath: text('storage_path'),
  storageType: text('storage_type').default('local'),
  // Digest of the dump as written, so a restore can prove the artefact it
  // fetched is byte-identical and detect silent storage corruption.
  checksum: text('checksum'),
  checksumAlgorithm: text('checksum_algorithm').default('sha256'),
  durationMs: integer('duration_ms'),
  initiatedAuto: boolean('initiated_auto').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  // Automated verification: proves the backup is locatable, intact and
  // restorable. Written by /api/cron/backup-verify.
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  verifiedOk: boolean('verified_ok'),
  verifyError: text('verify_error'),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    statusIdx: index('idx_backup_records_status').on(table.status, table.completedAt),
  };
});

// ── 8. BACKUP SCHEDULES ─────────────────────────────
export const backupSchedules = pgTable('backup_schedules', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  scheduleType: text('schedule_type').notNull().default('monthly'),
  backupType: text('backup_type').notNull().default('full'),
  retentionDays: integer('retention_days').notNull().default(90),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_backup_schedules_tenant').on(table.tenantId),
  };
});


// ── 9. CRITICAL DATA BACKUPS ────────────────────────
export const criticalDataBackups = pgTable('critical_data_backups', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').notNull(),
  tableName: text('table_name').notNull(),
  recordId: uuid('record_id').notNull(),
  backupData: jsonb('backup_data').notNull(),
  operation: text('operation').notNull(),
  backedUpAt: timestamp('backed_up_at', { withTimezone: true }).defaultNow(),
  retainedUntil: timestamp('retained_until', { withTimezone: true }).default(sql`now() + INTERVAL '90 days'`),
  canRestore: boolean('can_restore').default(true),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: index('idx_critical_backups_tenant').on(table.tenantId, table.tableName),
    retainIdx: index('idx_critical_backups_retain').on(table.retainedUntil),
    recordIdx: index('idx_critical_backups_record').on(table.tableName, table.recordId),
    canRestoreIdx: index('idx_critical_backups_can_restore').on(table.canRestore, table.backedUpAt),
  };
});

// ── 10. HEALTH CHECKS ─────────────────────────────────
export const healthChecks = pgTable('health_checks', {
  id: utils.pk(),
  service: text('service').notNull(),
  status: text('status').notNull().default('ok'),
  latencyMs: integer('latency_ms'),
  message: text('message'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    serviceIdx: index('idx_health_checks_service').on(table.service, table.checkedAt),
  };
});

// ── 11. REPORT EXECUTIONS ────────────────────────────
export const reportExecutions = pgTable('report_executions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id),
  reportId: uuid('report_id').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
  status: text('status').default('pending'),
  resultCount: integer('result_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 12. RESTORE SNAPSHOTS ────────────────────────────
export const restoreSnapshots = pgTable('restore_snapshots', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  snapshotData: jsonb('snapshot_data').notNull(),
  tableCount: integer('table_count'),
  recordCount: integer('record_count'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 13. SELECTIVE RESTORE AUDIT LOG ───────────────────
export const selectiveRestoreAuditLog = pgTable('selective_restore_audit_log', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  action: text('action').notNull(),
  tableName: text('table_name'),
  recordId: uuid('record_id'),
  oldData: jsonb('old_data'),
  newData: jsonb('new_data'),
  performedBy: uuid('performed_by').references(() => users.id),
  performedAt: timestamp('performed_at', { withTimezone: true }).defaultNow().notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 14. SELECTIVE RESTORE LOGS ────────────────────────
export const selectiveRestoreLogs = pgTable('selective_restore_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  backupId: uuid('backup_id').notNull(),
  action: text('action').notNull(),
  status: text('status').default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});


// ── 15. SUPER ADMIN BACKUPS ──────────────────────────
export const superAdminBackups = pgTable('super_admin_backups', {
  id: utils.pk(),
  backupName: text('backup_name').notNull(),
  backupType: text('backup_type').default('full'),
  storagePath: text('storage_path').notNull(),
  backupSize: bigint('backup_size', { mode: 'number' }),
  status: text('status').default('completed'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    nameIdx: index('idx_super_admin_backups_name').on(table.backupName),
    statusIdx: index('idx_super_admin_backups_status').on(table.status, table.createdAt),
  };
});

// ── 16. API USAGE ─────────────────────────────────────
export const apiKeyUsageInfra = pgTable('api_key_usage_infra', {
  id: utils.pk(),
  apiKeyId: uuid('api_key_id').notNull(), 
  tenantId: utils.tenantId(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  method: text('method'),
  path: text('path'),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    keyIdx: index('idx_api_key_usage_key').on(table.apiKeyId, table.createdAt),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 17. TEMPLATES (System-wide) ──────────────────────
export const dashboardTemplates = pgTable('dashboard_templates', {
  id: utils.pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  category: text('category'),
  layout: jsonb('layout').notNull().default([]),
  filters: jsonb('filters').notNull().default({}),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    activeIdx: utils.activeIdx(table),
  };
});

export const reportTemplates = pgTable('report_templates', {
  id: utils.pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  reportType: text('report_type').notNull(),
  queryConfig: jsonb('query_config').notNull().default({}),
  chartConfig: jsonb('chart_config').notNull().default({}),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    activeIdx: utils.activeIdx(table),
  };
});



import { uniqueIndex, pgTable, uuid, text, jsonb, timestamp, boolean, integer, index, bigint, numeric, date } from 'drizzle-orm/pg-core';
import { sql, isNull, isNotNull } from 'drizzle-orm';
import { tenants, users, roles } from './core';
import { contacts, deals, companies } from './crm';
import * as utils from './utils';

// ── 1. SYSTEM SETTINGS ────────────────────────────────
export const systemSettings = pgTable('system_settings', {
  id: utils.pk(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  ...utils.lifecycle(),
});

// ── 2. PLANS (Billing plans) ────────────────────────────
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  priceMonthly: numeric('price_monthly', { precision: 10, scale: 2 }).default('0'),
  priceYearly: numeric('price_yearly', { precision: 10, scale: 2 }).default('0'),
  priceCents: integer('price_cents').default(0),
  price: numeric('price', { precision: 10, scale: 2 }).default('0'),
  maxUsers: integer('max_users').default(5),
  maxContacts: integer('max_contacts').default(1000),
  maxDeals: integer('max_deals').default(500),
  maxStorageGb: numeric('max_storage_gb', { precision: 6, scale: 2 }).default('1'),
  maxAutomations: integer('max_automations').default(5),
  maxForms: integer('max_forms').default(3),
  maxApiCallsDay: integer('max_api_calls_day').default(1000),
  features: jsonb('features').default([]),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    nameIdx: index('idx_plans_name').on(table.name),
    slugIdx: index('idx_plans_slug').on(table.slug),
    activeIdx: index('idx_plans_active').on(table.isActive, table.sortOrder),
  };
});

// ── 3. BILLING & SUBSCRIPTIONS ────────────────────────
export const subscriptions = pgTable('subscriptions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  planId: text('plan_id').references(() => plans.id),
  status: text('status').notNull().default('active'),
  
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  
  metadata: utils.metadata(), // usage data, overage tracking
  
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 3. ACTIVITY TIMELINE ──────────────────────────────
export const activities = pgTable('activities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  
  // Polymorphic References (Systematic)
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'lead', 'task', etc.
  entityId: uuid('entity_id').notNull(),
  
  // Specific References (Legacy Compatibility)
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  
  eventType: text('event_type').notNull(), // 'contact_created', 'email_opened', etc
  action: text('action'), // for legacy compatibility
  description: text('description'),
  
  metadata: utils.metadata(), // full event details
  
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_activities_entity').on(table.entityType, table.entityId),
    contactIdx: index('idx_activities_contact').on(table.contactId),
    dealIdx: index('idx_activities_deal').on(table.dealId),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 4. TASKS & REMINDERS ──────────────────────────────
export const tasks = pgTable('tasks', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  status: text('status').notNull().default('pending'), // 'pending', 'completed', 'cancelled'
  
  dueDate: timestamp('due_date', { withTimezone: true }),
  completed: boolean('completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  
  metadata: utils.metadata(), // recurrence, AI suggestions
  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    tenantStatusIdx: index('idx_tasks_tenant_status').on(table.tenantId, table.status),
    assignedIdx: index('idx_tasks_assigned').on(table.assignedTo),
    createdByIdx: index('idx_tasks_created_by').on(table.createdBy),
    dueIdx: index('idx_tasks_due').on(table.dueDate),
    contactIdx: index('idx_tasks_contact').on(table.contactId),
    dealIdx: index('idx_tasks_deal').on(table.dealId),
    tenantDueActiveIdx: index('idx_tasks_tenant_due_active').on(table.tenantId, table.dueDate, table.createdAt).where(sql`deleted_at IS NULL`),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 5. BACKUP & RESTORE ───────────────────────────────
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

// ── 6. ANALYTICS & DASHBOARDS ─────────────────────────
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

// ── 7. BILLING EVENTS ─────────────────────────────────
export const billingEvents = pgTable('billing_events', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  eventType: text('event_type').notNull(), // 'invoice.payment_succeeded', 'subscription.created', etc.
  amount: numeric('amount', { precision: 10, scale: 2 }),
  currency: text('currency').default('usd'),
  stripeEventId: text('stripe_event_id').unique(),
  stripeInvoiceId: text('stripe_invoice_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    typeIdx: index('idx_billing_events_type').on(table.eventType, table.createdAt),
    stripeEventIdx: index('idx_billing_events_stripe_event').on(table.stripeEventId).where(sql`stripe_event_id IS NOT NULL`),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 8. USAGE SNAPSHOTS ───────────────────────────────
export const usageSnapshots = pgTable('usage_snapshots', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  snapshotDate: text('snapshot_date').notNull().default(sql`CURRENT_DATE::text`),
  contactsCount: integer('contacts_count').default(0),
  leadsCount: integer('leads_count').default(0),
  dealsCount: integer('deals_count').default(0),
  usersCount: integer('users_count').default(0),
  storageUsedMb: numeric('storage_used_mb', { precision: 10, scale: 2 }).default('0'),
  apiCallsCount: integer('api_calls_count').default(0),
  emailSentCount: integer('email_sent_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantDateIdx: index('idx_usage_snapshots_tenant_date').on(table.tenantId, table.snapshotDate),
    dateIdx: index('idx_usage_snapshots_date').on(table.snapshotDate),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 9. LIMIT VIOLATIONS ───────────────────────────────
export const limitViolations = pgTable('limit_violations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  violationType: text('violation_type').notNull(), // 'contacts_exceeded', 'users_exceeded', 'storage_exceeded'
  limitValue: integer('limit_value'),
  actualValue: integer('actual_value'),
  exceededAt: timestamp('exceeded_at', { withTimezone: true }).defaultNow(),
  notified: boolean('notified').default(false),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    unresolvedIdx: index('idx_limit_violations_unresolved').on(table.resolved, table.exceededAt).where(sql`resolved = false`),
  };
});

// ── 10. FILE UPLOADS ─────────────────────────────────
export const fileUploads = pgTable('file_uploads', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'note', 'etc.'
  entityId: uuid('entity_id').notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  ...utils.lifecycle(),
}, (table) => {
  return {
    entityIdx: index('idx_file_uploads_entity').on(table.entityType, table.entityId),
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 11. ANNOUNCEMENTS ─────────────────────────────────
export const announcements = pgTable('announcements', {
  id: utils.pk(),
  title: text('title').notNull(),
  body: text('body').notNull(),
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

// ── 12. TENANT BACKUP RECORDS ────────────────────────
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

// ── 13. TENANT RESTORE RECORDS ────────────────────────
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

// ── 14. BACKUP ALERTS ────────────────────────────────
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
  durationMs: integer('duration_ms'),
  initiatedAuto: boolean('initiated_auto').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    statusIdx: index('idx_backup_records_status').on(table.status, table.completedAt),
  };
});

// ── 15. BACKUP SCHEDULES ─────────────────────────────
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


// ── 15. CRITICAL DATA BACKUPS ────────────────────────
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

// ── 16. PERMISSION OVERRIDES ─────────────────────────
export const permissionOverrides = pgTable('permission_overrides', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  // entity_type + entity_id for row-level permissions
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  //LEGACY permissions override (read, write, delete, manage)
  permissions: jsonb('permissions').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    roleIdx: index('idx_permission_overrides_role').on(table.roleId),
    entityIdx: index('idx_permission_overrides_entity').on(table.entityType, table.entityId),
  };
});

// ── 17. HEALTH CHECKS ─────────────────────────────────
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

// ── 18. ONBOARDING PROGRESS ───────────────────────────
export const onboardingProgress = pgTable('onboarding_progress', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stepName: text('step_name').notNull(),
  isCompleted: boolean('is_completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantUserStepIdx: uniqueIndex('idx_onboarding_progress_unique').on(table.tenantId, table.userId, table.stepName),
    tenantUserIdx: index('idx_onboarding_tenant_user').on(table.tenantId, table.userId),
    stepIdx: index('idx_onboarding_step').on(table.stepName, table.isCompleted),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 19. PLATFORM SETTINGS ────────────────────────────
export const platformSettings = pgTable('platform_settings', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    keyIdx: index('idx_platform_settings_key').on(table.key).where(sql`key IS NOT NULL`),
    tenantIdx: utils.tenantIdx(table),
    uniqueGlobalKey: uniqueIndex('idx_platform_settings_global_unique').on(table.key).where(isNull(table.tenantId)),
    uniqueTenantKey: uniqueIndex('idx_platform_settings_tenant_unique').on(table.key, table.tenantId).where(isNotNull(table.tenantId)),
  };
});

// ── 20. REPORT EXECUTIONS ────────────────────────────
export const reportExecutions = pgTable('report_executions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id),
  reportId: uuid('report_id').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
  status: text('status').default('completed'),
  resultCount: integer('result_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 21. REVENUE FORECAST SUMMARY ─────────────────────
export const revenueForecastSummary = pgTable('revenue_forecast_summary', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  forecastDate: date('forecast_date').notNull().default(sql`CURRENT_DATE`),
  totalExpectedRevenue: numeric('total_expected_revenue', { precision: 15, scale: 2 }).default('0'),
  totalDeals: integer('total_deals').default(0),
  avgDealValue: numeric('avg_deal_value', { precision: 12, scale: 2 }).default('0'),
  winRate: numeric('win_rate', { precision: 5, scale: 2 }).default('0'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantDateIdx: index('idx_revenue_forecast_tenant_date').on(table.tenantId, table.forecastDate),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 22. RESTORE SNAPSHOTS ────────────────────────────
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

// ── 23. SELECTIVE RESTORE AUDIT LOG ───────────────────
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

// ── 23. SELECTIVE RESTORE LOGS ────────────────────────
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


// ── 24. SUPER ADMIN BACKUPS ──────────────────────────
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

// ── 25. USER DEPARTURES ───────────────────────────────
export const userDepartures = pgTable('user_departures', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  userEmail: text('user_email'),
  userName: text('user_name'),
  departureDate: date('departure_date'),
  departedBy: uuid('departed_by').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  notes: text('notes'),
  isRehirable: boolean('is_rehirable').default(false),
  contactsReassignedTo: uuid('contacts_reassigned_to').references(() => users.id, { onDelete: 'set null' }),
  contactsCount: integer('contacts_count').default(0),
  dealsCount: integer('deals_count').default(0),
  tasksCount: integer('tasks_count').default(0),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    userIdx: index('idx_user_departures_user').on(table.userId),
    dateIdx: index('idx_user_departures_date').on(table.departureDate),
  };
});

// ── 26. API USAGE ─────────────────────────────────────
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

// ── 27. TEMPLATES (System-wide) ──────────────────────
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

// ── 28. ENTERPRISE AUTH (SSO) ────────────────────────
export const ssoProviders = pgTable('sso_providers', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  providerType: text('provider_type').notNull(), // 'saml', 'oidc', 'oauth2'
  name: text('name').notNull(),
  config: jsonb('config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table).where(sql`is_active = true`),
    activeIdx: utils.activeIdx(table),
  };
});

export const ssoSessions = pgTable('sso_sessions', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  providerId: uuid('provider_id').references(() => ssoProviders.id, { onDelete: 'set null' }),
  sessionId: text('session_id').notNull(),
  idToken: text('id_token'),
  samlAssertion: text('saml_assertion'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    userIdx: index('idx_sso_sessions_user').on(table.userId, table.createdAt),
    sessionIdx: index('idx_sso_sessions_id').on(table.sessionId),
    tenantIdx: utils.tenantIdx(table),
  };
});

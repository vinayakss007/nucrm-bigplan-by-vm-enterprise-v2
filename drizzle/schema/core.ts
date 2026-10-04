/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { uniqueIndex, pgTable, uuid, text, timestamp, boolean, jsonb, index, inet, integer, bigint, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';

// ── 1. THE FOUNDATION (TENANTS) ───────────────────────
export const tenants = pgTable('tenants', {
  id: utils.pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  shortCode: text('short_code').unique(),
  subdomain: text('subdomain'),
  
  status: text('status').notNull().default('trialing'),
  planId: text('plan_id').notNull().default('free'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).default(sql`(now() + '14 days'::interval)`),
  
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  primaryColor: text('primary_color').default('#7c3aed'),
  billingEmail: text('billing_email'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  customDomain: text('custom_domain').unique(),
  
  // Billing / Stripe
  subscriptionId: text('subscription_id'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  billingType: text('billing_type').default('trial'),
  manualPaidUntil: timestamp('manual_paid_until', { withTimezone: true }),
  
  // Usage tracking
  currentUsers: integer('current_users').default(0),
  currentContacts: integer('current_contacts').default(0),
  currentDeals: integer('current_deals').default(0),
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).default(0),
  
  // Business info
  industry: text('industry'),
  companySize: text('company_size'),
  country: text('country'),
  
  // Verification
  domainVerified: boolean('domain_verified').default(false),
  domainVerifiedAt: timestamp('domain_verified_at', { withTimezone: true }),
  
  adminNotes: text('admin_notes'),
  settings: jsonb('settings').default({}),
  ...utils.lifecycle(),
  metadata: utils.metadata(),
}, (table) => {
  return {
    slugIdx: index('idx_tenants_slug').on(table.slug),
    subdomainIdx: index('idx_tenants_subdomain').on(table.subdomain),
    statusIdx: index('idx_tenants_status').on(table.status),
    metadataGinIdx: utils.metadataIdx(table),
  
  drz2255_tenants_slug_unique: uniqueIndex('tenants_slug_unique').on(table.slug),
  drz2255_tenants_custom_domain_unique: uniqueIndex('tenants_custom_domain_unique').on(table.customDomain),
  drz2255_idx_tenants_short_code: uniqueIndex('idx_tenants_short_code').on(table.shortCode).where(sql`(short_code IS NOT NULL)`),
  drz2255_idx_tenants_owner_id: index('idx_tenants_owner_id').on(table.ownerId),};
});

// ── 2. IDENTITY (USERS & AUTH) ────────────────────────
export const users = pgTable('users', {
  id: utils.pk(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  timezone: text('timezone').default('UTC'),
  isSuperAdmin: boolean('is_super_admin').default(false),
  lastTenantId: uuid('last_tenant_id'),
  defaultTenantId: uuid('default_tenant_id'),
  emailVerified: boolean('email_verified').default(false),
  emailVerifyToken: text('email_verify_token'),
  resetToken: text('reset_token'),
  resetTokenExpires: timestamp('reset_token_expires', { withTimezone: true }),
  oauthProvider: text('oauth_provider'),
  oauthId: text('oauth_id'),

  // User Preferences
  locale: text('locale').default('en'),
  theme: text('theme').default('light'),

  // Telegram Notifications
  telegramBotToken: text('telegram_bot_token'),
  telegramChatId: text('telegram_chat_id'),
  telegramEnabled: boolean('telegram_enabled').default(false),
  telegramNotifyLogin: boolean('telegram_notify_login').default(true),
  telegramNotifySignup: boolean('telegram_notify_signup').default(true),
  telegramNotifyPasswordChange: boolean('telegram_notify_password_change').default(true),
  telegramNotify2faChange: boolean('telegram_notify_2fa_change').default(true),
  telegramNotifySecurityAlerts: boolean('telegram_notify_security_alerts').default(true),

  // TOTP / Security
  totpEnabled: boolean('totp_enabled').default(false),
  totpSecret: text('totp_secret'),
  totpBackupCodes: jsonb('totp_backup_codes'),
  totpVerifiedAt: timestamp('totp_verified_at', { withTimezone: true }),

  // Rate Limiting
  unlimitedRateLimit: boolean('unlimited_rate_limit').default(false),

  deletedBy: utils.deletedBy(),
  
  ...utils.lifecycle(),
  metadata: utils.metadata(),
}, (table) => {
  return {
    emailIdx: index('idx_users_email').on(table.email),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  
  drz2255_users_email_unique: uniqueIndex('users_email_unique').on(table.email),};
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...utils.lifecycle(),
}, (table) => ({
  // #2255 live-DB mirror
  drz2255_refresh_tokens_token_unique: uniqueIndex('refresh_tokens_token_unique').on(table.token),
  drz2255_idx_refresh_tokens_user_id: index('idx_refresh_tokens_user_id').on(table.userId),
}));

export const passwordResets = pgTable('password_resets', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...utils.lifecycle(),
}, (table) => ({
  // #2255 live-DB mirror
  drz2255_password_resets_token_unique: uniqueIndex('password_resets_token_unique').on(table.token),
  drz2255_idx_password_resets_user_id: index('idx_password_resets_user_id').on(table.userId),
}));

// ── 3. ISOLATION & ACCESS ─────────────────────────────
export const tenantMembers = pgTable('tenant_members', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  roleSlug: text('role_slug').notNull().default('member'),
  status: text('status').notNull().default('active'),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow(),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  settings: jsonb('settings').default({}),
  notificationPrefs: jsonb('notification_prefs').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    userIdx: index('idx_tenant_members_user').on(table.userId),
    tenantUserIdx: uniqueIndex('idx_tenant_members_tenant_user').on(table.tenantId, table.userId),
  
  drz2255_idx_tenant_members_invited_by: index('idx_tenant_members_invited_by').on(table.invitedBy),
  drz2255_idx_tenant_members_role_id: index('idx_tenant_members_role_id').on(table.roleId),};
});

export const roles = pgTable('roles', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false),
  permissions: jsonb('permissions').default({}),
  sortOrder: integer('sort_order').default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    tenantSlugIdx: uniqueIndex('idx_roles_tenant_slug').on(table.tenantId, table.slug),
  };
});

// ── 4. SECURITY & IMPERSONATION ───────────────────────
export const sessions = pgTable('sessions', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    tokenIdx: index('idx_sessions_token').on(table.tokenHash),
  
  drz2255_sessions_token_hash_unique: uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  drz2255_idx_sessions_user_id: index('idx_sessions_user_id').on(table.userId),};
});

export const impersonationSessions = pgTable('impersonation_sessions', {
  id: utils.pk(),
  impersonatorId: uuid('impersonator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  reason: text('reason'),
  notes: text('notes'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    activeIdx: index('idx_impersonation_sessions_active').on(table.impersonatorId, table.startedAt).where(sql`ended_at IS NULL`),
  
  drz2255_idx_impersonation_sessions_target_user_id: index('idx_impersonation_sessions_target_user_id').on(table.targetUserId),
  drz2255_idx_impersonation_sessions_tenant_id: index('idx_impersonation_sessions_tenant_id').on(table.tenantId),};
});

export const fieldPermissions = pgTable('field_permissions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  fieldName: text('field_name').notNull(),
  accessLevel: text('access_level').notNull().default('none'), // 'none', 'read', 'write', 'admin'
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueRoleField: uniqueIndex('idx_field_permissions_unique').on(table.tenantId, table.roleId, table.entityType, table.fieldName),
  };
});

export const recordPermissions = pgTable('record_permissions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  accessLevel: text('access_level').notNull().default('none'), // 'none', 'read', 'write', 'admin'
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    entityIdx: index('idx_record_permissions_entity').on(table.tenantId, table.entityType, table.entityId),
    roleIdx: index('idx_record_permissions_role').on(table.tenantId, table.roleId),
  
  drz2255_idx_record_permissions_granted_by: index('idx_record_permissions_granted_by').on(table.grantedBy),};
});

// ── 4B. APPROVAL WORKFLOWS ────────────────────────────
export const approvalRequests = pgTable('approval_requests', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  ruleId: text('rule_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected'
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  rejectedBy: uuid('rejected_by').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  // #1632 multi-step approval chains. `steps` is an ordered list of
  // { order, approverRole?, status: 'pending'|'approved'|'rejected', actedBy?,
  //   actedAt?, reason? }. `currentStep` is the 1-based index of the step
  // awaiting action. A request with an empty `steps` array behaves as a legacy
  // single-stage approval (one approve finalizes it) for backward compatibility.
  steps: jsonb('steps').notNull().default([]),
  currentStep: integer('current_step').notNull().default(1),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_approval_requests_entity').on(table.tenantId, table.entityType, table.entityId),
    statusIdx: index('idx_approval_requests_status').on(table.tenantId, table.status),
  
  drz2255_idx_approval_requests_approved_by: index('idx_approval_requests_approved_by').on(table.approvedBy),
  drz2255_idx_approval_requests_rejected_by: index('idx_approval_requests_rejected_by').on(table.rejectedBy),
  drz2255_idx_approval_requests_requested_by: index('idx_approval_requests_requested_by').on(table.requestedBy),};
});

// ── 5. API & INFRASTRUCTURE ───────────────────────────
export const apiKeys = pgTable('api_keys', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  scopes: jsonb('scopes').default(['*']),
  isActive: boolean('is_active').default(true),
  callCount: bigint('call_count', { mode: 'number' }).default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: text('last_used_ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  
  drz2255_api_keys_key_hash_unique: uniqueIndex('api_keys_key_hash_unique').on(table.keyHash),
  drz2255_idx_api_keys_user_id: index('idx_api_keys_user_id').on(table.userId),};
});

export const apiKeyUsage = pgTable('api_key_usage', {
  id: utils.pk(),
  apiKeyId: uuid('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  ipAddress: inet('ip_address'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_api_key_usage_tenant').on(table.tenantId),
    createdAtIdx: index('idx_api_key_usage_created').on(table.createdAt),
  
  drz2255_idx_api_key_usage_api_key_id: index('idx_api_key_usage_api_key_id').on(table.apiKeyId),
  drz2255_idx_api_key_usage_tenant_id: index('idx_api_key_usage_tenant_id').on(table.tenantId),};
});

// ── 6. LOGS & NOTIFICATIONS ───────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  // Actor id, deliberately NOT a foreign key (migration 0050). Retaining the
  // actor is the purpose of an audit log, and ON DELETE SET NULL would both erase
  // attribution when a user is deleted and trip the append-only UPDATE trigger
  // from 0042, making user deletion impossible.
  userId: uuid('user_id'),
  impersonatedBy: uuid('impersonated_by'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  oldData: jsonb('old_data'),
  newData: jsonb('new_data'),
  metadata: utils.metadata(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  previousHash: text('previous_hash'),
  hash: text('hash'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    metadataGinIdx: utils.metadataIdx(table),
  
  drz2255_idx_audit_logs_tenant_created: index('idx_audit_logs_tenant_created').on(table.tenantId, table.createdAt.desc()),
  drz2255_idx_audit_logs_user: index('idx_audit_logs_user').on(table.tenantId, table.userId, table.createdAt.desc()),
  drz2255_idx_audit_logs_resource: index('idx_audit_logs_resource').on(table.tenantId, table.entityType, table.entityId, table.createdAt.desc()),
  drz2255_idx_audit_logs_action: index('idx_audit_logs_action').on(table.tenantId, table.action, table.createdAt.desc()),};
});

export const notifications = pgTable('notifications', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull().default('info'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    userIdx: index('idx_notifications_user').on(table.userId),
    // Hot path: widget filters (tenant, user, unread) + sorts createdAt DESC.
    tenantUserCreatedIdx: index('idx_notifications_tenant_user_created').on(table.tenantId, table.userId, table.createdAt),
    metadataGinIdx: utils.metadataIdx(table),
  
  drz2255_idx_notifications_unread: index('idx_notifications_unread').on(table.userId, table.tenantId).where(sql`(read_at IS NULL)`),
  drz2255_idx_notifications_recent: index('idx_notifications_recent').on(table.userId, table.createdAt.desc()).where(sql`(read_at IS NULL)`),};
});

export const invitations = pgTable('invitations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  email: text('email').notNull(),
  roleSlug: text('role_slug').notNull().default('member'),
  token: text('token').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    tenantEmailIdx: uniqueIndex('idx_invitations_tenant_email').on(table.tenantId, table.email),
  
  drz2255_invitations_token_unique: uniqueIndex('invitations_token_unique').on(table.token),};
});

// ── 7. FEATURE REGISTRY ───────────────────────────────
export const featureRegistry = pgTable('feature_registry', {
  id: utils.pk(),
  featureName: text('feature_name').notNull().unique(),
  description: text('description'),
  version: text('version').default('1.0.0'),
  enabled: boolean('enabled').default(true),
  metadataKeys: jsonb('metadata_keys').default([]),
  entities: jsonb('entities').default([]),
  requiresTables: jsonb('requires_tables').default([]),
  registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow(),
  ...utils.lifecycle(),
  }, (table) => {
    return {
      enabledIdx: index('idx_feature_registry_enabled').on(table.enabled),
    
    drz2255_feature_registry_feature_name_unique: uniqueIndex('feature_registry_feature_name_unique').on(table.featureName),};
  });

// ── 8. PERMISSION OVERRIDES ───────────────────────────
export const permissionOverrides = pgTable('permission_overrides', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  permissions: jsonb('permissions').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    roleIdx: index('idx_permission_overrides_role').on(table.roleId),
    entityIdx: index('idx_permission_overrides_entity').on(table.entityType, table.entityId),
  };
});

// ── 9. ONBOARDING PROGRESS ────────────────────────────
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

// ── 10. USER DEPARTURES ──────────────────────────────
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
  
  drz2255_idx_user_departures_contacts_reassigned_to: index('idx_user_departures_contacts_reassigned_to').on(table.contactsReassignedTo),
  drz2255_idx_user_departures_created_by: index('idx_user_departures_created_by').on(table.createdBy),
  drz2255_idx_user_departures_departed_by: index('idx_user_departures_departed_by').on(table.departedBy),};
});

// Register FK table references (lazy, broken after circular dep init)
utils._registerFkRefs(tenants, users);

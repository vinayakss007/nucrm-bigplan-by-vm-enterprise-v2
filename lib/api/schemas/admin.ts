import { z } from 'zod';

const uuid = z.string().uuid().optional().nullable();
const requiredString = z.string().trim().min(1);

// ── Platform settings schema (superadmin) ──
export const platformSettingsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

// ── Announcement schemas (superadmin) ──
export const createAnnouncementSchema = z.object({
  title: requiredString.max(200),
  body: z.string().max(10000).optional().nullable(),
  content: z.string().max(10000).optional().nullable(),
  type: z.enum(['info', 'warning', 'critical', 'maintenance']).default('info'),
  target: z.enum(['all', 'superadmin', 'tenant_admin']).default('all'),
  is_active: z.boolean().default(true),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
});

export const updateAnnouncementSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean().default(true),
});

export const deleteAnnouncementSchema = z.object({
  id: z.string().uuid(),
});

// ── AI System Key schema (superadmin) ──
export const setSystemKeySchema = z.object({
  tenantId: z.string().uuid(),
  provider: requiredString.max(50),
  api_key: z.string().max(4000).default(''),
  base_url: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
});

// ── Rate limit schema (superadmin) ──
const rateLimitsRecord = z.record(z.string(), z.number().int().min(0).max(100000));
export const updateRateLimitsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_global'),
    rateLimits: rateLimitsRecord,
  }),
  z.object({
    action: z.literal('update_plan_limits'),
    planId: z.string().uuid(),
    rateLimits: rateLimitsRecord,
  }),
  z.object({
    action: z.literal('toggle_super_admin_unlimited'),
    userId: z.string().uuid(),
    unlimited: z.boolean(),
  }),
  z.object({
    action: z.literal('reset_to_defaults'),
    planId: z.string().uuid(),
  }),
]);

// ── AI Provider config schema (tenant admin) ──
const providerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  default_model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(16).max(32000).optional(),
  fallback_priority: z.number().int().min(1).max(99).optional(),
  api_key: z.string().max(4000).optional(),
  base_url: z.string().url().max(500).optional(),
});

export const updateAiProvidersSchema = z.object({
  providers: z.record(z.string().max(100), providerConfigSchema),
});

// ── Lead Scoring schemas (tenant admin) ──
export const createLeadScoringRuleSchema = z.object({
  factor: requiredString.max(500),
  weight: z.number().min(-100).max(100).default(10),
  condition: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});

export const updateLeadScoringRuleSchema = z.object({
  id: z.string().uuid(),
  factor: z.string().max(500).optional(),
  weight: z.number().min(-100).max(100).optional(),
  condition: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

// ── AI Draft Template schemas (tenant admin) ──
const validTemplateKinds = z.enum(['email', 'note', 'reply', 'call_prep']);
export const createAiTemplateSchema = z.object({
  slug: z.string().max(60).optional(),
  name: requiredString.max(120),
  description: z.string().max(500).optional().nullable(),
  kind: validTemplateKinds.default('email'),
  entity_types: z.union([z.string(), z.array(z.string())]).optional(),
  system_prompt: requiredString.max(8000),
  user_prompt: requiredString.max(8000),
  tone: z.string().max(50).default('professional'),
  default_subject: z.string().max(200).optional().nullable(),
  active: z.boolean().default(true),
});

// ── Hierarchy schemas (tenant admin) ──
export const createHierarchySchema = z.object({
  childTenantId: z.string().uuid(),
  relationship: z.enum(['parent', 'division', 'franchise', 'branch']).default('parent'),
  permissions: z.array(z.string().max(100)).optional(),
});

export const updateHierarchySchema = z.object({
  id: z.string().uuid(),
  relationship: z.enum(['parent', 'division', 'franchise', 'branch']),
});

export const deleteHierarchySchema = z.object({
  id: z.string().uuid(),
});

// ── Automation schemas ──
export const createAutomationSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  trigger: z.enum(['form_submit', 'deal_stage_change', 'contact_created', 'task_completed', 'subscription_change', 'manual']),
  conditions: z.array(z.object({
    field: requiredString.max(100),
    operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than']),
    value: z.string().max(500),
  })).optional(),
  actions: z.array(z.object({
    type: z.enum(['send_email', 'create_task', 'update_field', 'send_webhook', 'add_tag', 'notify_user']),
    config: z.record(z.string(), z.unknown()),
  })).optional(),
  isActive: z.boolean().optional(),
});

export const updateAutomationSchema = createAutomationSchema.partial();

// ── Workflow schemas ──
export const createWorkflowSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  isActive: z.boolean().optional(),
});

// ── Email Sequence schemas ──
export const createSequenceSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  steps: z.array(z.object({
    delayDays: z.number().int().min(0),
    subject: requiredString.max(200),
    body: requiredString.max(10000),
  })).optional(),
  isActive: z.boolean().optional(),
});

export const updateSequenceSchema = createSequenceSchema.partial();

// ── Webhook schemas ──
export const createWebhookSchema = z.object({
  name: requiredString.max(200),
  url: z.string().url().max(500),
  events: z.array(z.string().max(100)).min(1),
  secret: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

export const updateWebhookSchema = createWebhookSchema.partial();

// ── API Key schemas ──
export const createApiKeySchema = z.object({
  name: requiredString.max(100),
  permissions: z.array(z.string().max(100)).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

// ── Form schemas ──
export const createFormSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  fields: z.array(z.object({
    key: requiredString.max(100),
    label: requiredString.max(200),
    type: z.enum(['text', 'email', 'phone', 'textarea', 'select', 'checkbox', 'number', 'date']),
    required: z.boolean().optional(),
    placeholder: z.string().max(200).optional(),
    options: z.array(z.string().max(200)).optional(),
  })).min(1),
  settings: z.object({
    success_message: z.string().max(500).optional(),
    notify_email: z.string().email().optional(),
    redirect_url: z.string().url().optional(),
  }).optional(),
  redirect_url: z.string().url().optional(),
  success_message: z.string().max(500).optional(),
});

export const updateFormSchema = createFormSchema.partial();

// ── Email Template schemas ──
export const createEmailTemplateSchema = z.object({
  name: requiredString.max(200),
  subject: requiredString.max(200),
  body: requiredString.max(50000),
  category: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();

// ── Role schemas ──
export const createRoleSchema = z.object({
  name: requiredString.max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string().max(100)).min(1),
});

export const updateRoleSchema = createRoleSchema.partial();

// ── Member schemas ──
export const inviteMemberSchema = z.object({
  email: z.string().email().max(255),
  role: z.string().max(100),
});

// ── Bulk operation schemas ──
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  updates: z.record(z.string(), z.unknown()).refine(
    (obj) => Object.keys(obj).length > 0,
    'At least one field must be provided'
  ),
});

// ── Export schemas ──
export const exportSchema = z.object({
  entity: z.enum(['contacts', 'deals', 'companies', 'leads', 'tasks', 'tickets', 'invoices', 'quotes', 'orders', 'contracts']),
  format: z.enum(['csv', 'xlsx']).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string().max(100)).optional(),
});

// ── Import schemas ──
export const importSchema = z.object({
  entity: z.enum(['contacts', 'deals', 'companies', 'leads', 'tasks', 'tickets', 'invoices', 'quotes']),
  mappings: z.record(z.string(), z.string()).optional(),
  overwrite: z.boolean().optional(),
});

// ── Search schemas ──
export const searchSchema = z.object({
  q: requiredString.max(200),
  entity: z.enum(['contacts', 'deals', 'companies', 'leads', 'tasks', 'tickets', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ── KB Article schemas ──
export const createKbArticleSchema = z.object({
  title: requiredString.max(200),
  content: requiredString.max(50000),
  categoryId: uuid,
  tags: z.array(z.string().max(50)).optional(),
  isPublished: z.boolean().optional(),
});

// ── KB Category schemas ──
export const createKbCategorySchema = z.object({
  name: requiredString.max(100),
  description: z.string().max(500).optional(),
  parentId: uuid,
});

// ── Integration schemas ──
export const createIntegrationSchema = z.object({
  type: requiredString.max(50),
  name: requiredString.max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

// ── Service schemas ──
export const createServiceSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  price: z.number().min(0),
  currency: z.string().length(3).optional(),
  interval: z.enum(['one_time', 'monthly', 'yearly']).optional(),
  isActive: z.boolean().optional(),
});

// ── Product schemas ──
export const createProductSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(1000).optional(),
  price: z.number().min(0),
  currency: z.string().length(3).optional(),
  sku: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

// ── 2FA schemas ──
export const enable2faSchema = z.object({
  totp_token: z.string().length(6).regex(/^\d+$/),
});

export const verify2faSchema = z.object({
  totp_token: z.string().length(6).regex(/^\d+$/),
});

// ── Notification preference schemas ──
export const updateNotificationPrefsSchema = z.object({
  email_notifications: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  sms_notifications: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// ── Password change schema ──
export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

// ── Profile update schema ──
const urlField = z.string().max(500).optional().nullable().or(z.literal('')).transform(v => {
  if (!v) return v;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return 'https://' + v;
});

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(255).optional(),
  avatar_url: urlField,
  bio: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
});

// ── Tenant settings schemas ──
export const updateTenantSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  logo_url: urlField,
  domain: z.string().max(200).optional(),
  industry: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  currency: z.string().length(3).optional(),
  trial_days: z.number().int().min(0).max(365).optional(),
});

// ── Scheduled report schemas ──
export const createScheduledReportSchema = z.object({
  name: requiredString.max(200),
  report_type: z.enum(['revenue', 'pipeline', 'activity', 'custom']),
  schedule: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(z.string().email()).min(1),
  filters: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

// ── Backup schemas ──
export const createBackupSchema = z.object({
  name: z.string().max(200).optional(),
  includeContacts: z.boolean().optional(),
  includeDeals: z.boolean().optional(),
  includeForms: z.boolean().optional(),
  includeSettings: z.boolean().optional(),
});

export const backupConfigSchema = z.object({
  autoBackup: z.boolean().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  retentionDays: z.number().int().min(7).max(365).optional(),
});

// ── Custom Field schemas ──
export const createCustomFieldSchema = z.object({
  entity: z.enum(['contact', 'deal', 'company', 'lead', 'task', 'ticket']),
  name: requiredString.max(100),
  type: z.enum(['text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone']),
  options: z.array(z.string().max(200)).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateCustomFieldSchema = createCustomFieldSchema.partial().extend({
  id: z.string().uuid(),
});

// ── Contact Merge schema ──
export const mergeContactSchema = z.object({
  primaryId: z.string().uuid(),
  secondaryIds: z.array(z.string().uuid()).min(1).max(10),
});

// ── Lead Convert schema ──
export const convertLeadSchema = z.object({
  leadId: z.string().uuid(),
  createContact: z.boolean().optional(),
  createDeal: z.boolean().optional(),
  dealValue: z.number().min(0).optional(),
  dealStageId: uuid,
});

// ── Trigger Workflow schema ──
export const triggerWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
  entity: z.enum(['contact', 'deal', 'lead', 'task', 'ticket']),
  entityId: z.string().uuid(),
});

// ── WhatsApp Send schema ──
export const sendWhatsAppSchema = z.object({
  to: z.string().min(1).max(50),
  message: requiredString.max(1000),
  templateName: z.string().max(100).optional(),
});

// ── Email Test schema ──
export const testEmailSchema = z.object({
  to: z.string().email(),
  subject: requiredString.max(200),
  body: requiredString.max(10000),
});

// ── Public Lead Capture schema ──
export const publicLeadCaptureSchema = z.object({
  form: requiredString.max(100),
  first_name: requiredString.max(100),
  last_name: z.string().max(100).optional(),
  email: z.string().email().max(255),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
  message: z.string().max(5000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

// ── Public Form Submit schema ──
export const publicFormSubmitSchema = z.object({
  form_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional(),
  source: z.string().max(200).optional(),
  url: z.string().url().optional(),
});

// ── IP Whitelist schema ──
export const ipWhitelistSchema = z.object({
  ips: z.array(z.string().regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, 'Invalid IP address')).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

// ── Email Warmup Config schema ──
export const emailWarmupConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(100).optional(),
  warmupDays: z.number().int().min(1).max(90).optional(),
  startingVolume: z.number().int().min(1).max(50).optional(),
});

// ── Onboarding Step schema ──
export const onboardingStepSchema = z.object({
  step: z.number().int().min(1).max(10),
  completed: z.boolean(),
});

// ── AI Assistant schema ──
export const aiAssistantSchema = z.object({
  message: requiredString.max(10000),
  context: z.enum(['contact', 'deal', 'lead', 'general']).optional(),
  entityId: uuid,
  provider: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
});

// ── Assign Contact schema (bulk assign) ──
export const assignContactSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(100),
  assigneeId: z.string().uuid(),
});

// ── Update Member schema ──
export const updateMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

// ── Telegram Settings schema ──
export const updateTelegramSchema = z.object({
  botToken: z.string().max(200).optional(),
  chatId: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── Checkout Session schema ──
export const checkoutSessionSchema = z.object({
  planId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// ── Superadmin schemas ──
export const createPlanSchema = z.object({
  name: requiredString.max(100),
  description: z.string().max(500).optional(),
  price: z.number().min(0),
  currency: z.string().length(3).optional(),
  interval: z.enum(['monthly', 'yearly']),
  features: z.array(z.string().max(200)).optional(),
  limits: z.record(z.string(), z.number().int().min(0)).optional(),
  isActive: z.boolean().optional(),
});

export const updatePlanSchema = createPlanSchema.partial();

export const createTenantSchema = z.object({
  name: requiredString.max(200),
  ownerId: uuid,
  planId: uuid,
  domain: z.string().max(200).optional(),
  industry: z.string().max(100).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

// ── Follow-Up schemas ──
export const createFollowUpSchema = z.object({
  title: requiredString.max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  lead_id: uuid,
  contact_id: uuid,
  deal_id: uuid,
  assigned_to: uuid,
  status: z.enum(['pending', 'completed', 'missed', 'cancelled']).optional().default('pending'),
  auto_ai_enabled: z.boolean().optional().default(false),
});

export const updateFollowUpSchema = createFollowUpSchema.partial();

export const followUpQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  due_before: z.string().datetime().optional(),
  due_after: z.string().datetime().optional(),
  missed_only: z.coerce.boolean().optional().default(false),
});

// ── At-Risk Rules schemas ──
export const atRiskRuleSchema = z.object({
  stage_id: uuid,
  max_days_idle: z.coerce.number().int().min(1).max(365).default(14),
  max_days_in_stage: z.coerce.number().int().min(1).max(365).optional().nullable(),
  sentiment_threshold: z.coerce.number().int().min(0).max(100).default(30),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateAtRiskRuleSchema = atRiskRuleSchema.partial();

// ── Auth schemas ──
export const signupSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(255),
  workspace_name: z.string().trim().min(1).max(255),
});

export const loginSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
  totp_token: z.string().optional(),
  remember_me: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export const tagActionSchema = z.object({
  action: z.enum(['rename', 'merge', 'delete']),
  tag: z.string().trim().min(1).max(40).regex(/^[\w \-./&]{1,40}$/).optional(),
  new_tag: z.string().trim().min(1).max(40).regex(/^[\w \-./&]{1,40}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
});

export const upsertPicklistSchema = z.object({
  category: z.enum(['lead_sources', 'loss_reasons', 'win_reasons', 'activity_types', 'deal_types', 'industries']),
  entries: z.array(z.object({
    value: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(80),
    color: z.string().trim().max(7).optional(),
  })).max(50),
});

export const preferencesPatchSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  font_size: z.enum(['small', 'normal', 'large', 'xl']).optional(),
  ui_density: z.enum(['compact', 'cozy', 'comfy']).optional(),
  accent_color: z.enum(['violet', 'indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate']).optional(),
  sidebar_default: z.enum(['expanded', 'collapsed']).optional(),
  date_format: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).optional(),
  time_format: z.enum(['12h', '24h']).optional(),
  week_start: z.enum(['sunday', 'monday']).optional(),
  default_landing: z.string().optional(),
  default_record_view: z.enum(['list', 'kanban', 'calendar', 'card']).optional(),
  default_page_size: z.number().int().min(10).max(100).optional(),
  confirm_destructive: z.enum(['always', 'danger_only', 'never']).optional(),
  default_calendar_view: z.enum(['day', 'week', 'month', 'agenda']).optional(),
  email_tracking_default: z.enum(['on', 'off', 'ask']).optional(),
  default_meeting_duration: z.number().int().min(15).max(90).optional(),
  online_status_visible: z.enum(['everyone', 'team', 'nobody']).optional(),
  activity_visible_to: z.enum(['everyone', 'team', 'managers', 'nobody']).optional(),
  reduce_motion: z.boolean().optional(),
  high_contrast: z.boolean().optional(),
  show_avatars: z.boolean().optional(),
  links_open_new_tab: z.boolean().optional(),
  keyboard_shortcuts_enabled: z.boolean().optional(),
  sticky_filters: z.boolean().optional(),
  show_tips: z.boolean().optional(),
  autosave_drafts: z.boolean().optional(),
  show_keyboard_hints: z.boolean().optional(),
  email_signature: z.string().max(5000).optional(),
  auto_cc_self: z.boolean().optional(),
  hidden_nav_items: z.array(z.string().max(200)).max(200).optional(),
});

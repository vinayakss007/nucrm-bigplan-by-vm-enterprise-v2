import { z } from 'zod';
import { requiredString } from './common';

// ── Custom Field schemas ──
const customFieldTypes = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'email', 'phone', 'currency', 'json'] as const;

export const createCustomFieldSchema = z.object({
  entityType: requiredString.max(50),
  fieldKey: z.string().regex(/^[a-zA-Z0-9_]+$/, 'fieldKey must be alphanumeric (underscores allowed)').max(100),
  fieldLabel: requiredString.max(200),
  fieldType: z.enum(customFieldTypes).optional().default('text'),
  fieldOptions: z.array(z.string()).optional().nullable(),
  isRequired: z.boolean().optional().default(false),
  isSearchable: z.boolean().optional().default(true),
  defaultValue: z.unknown().optional(),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  isCalculated: z.boolean().optional().default(false),
  formula: z.string().max(1000).optional().nullable(),
});

export const updateCustomFieldSchema = z.object({
  fieldId: z.string().uuid(),
  fieldLabel: z.string().trim().max(200).optional(),
  fieldType: z.enum(customFieldTypes).optional(),
  fieldOptions: z.array(z.string()).optional().nullable(),
  isRequired: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isCalculated: z.boolean().optional(),
  formula: z.string().max(1000).optional().nullable(),
});

// ── Integration schemas ──
export const createIntegrationSchema = z.object({
  name: requiredString.max(100),
  type: requiredString.max(50),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  is_active: z.boolean().optional().default(true),
});

export const updateIntegrationSchema = createIntegrationSchema.partial();

// ── Onboarding Step schema ──
export const onboardingStepSchema = z.object({
  step: z.string().trim().max(100).optional(),
  complete: z.boolean().optional(),
});

// ── Update Member schema ──
export const updateMemberSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  full_name: z.string().trim().max(200).optional(),
  role_slug: z.string().trim().max(50).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

// ── Tag Action schema ──
export const tagActionSchema = z.object({
  action: z.enum(['rename', 'merge', 'delete']),
  tag: z.string().trim().min(1).max(40).regex(/^[\w \-./&]{1,40}$/).optional(),
  new_tag: z.string().trim().min(1).max(40).regex(/^[\w \-./&]{1,40}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
});

// ── Upsert Picklist schema ──
export const upsertPicklistSchema = z.object({
  category: z.enum(['lead_sources', 'loss_reasons', 'win_reasons', 'activity_types', 'deal_types', 'industries']),
  entries: z.array(z.object({
    value: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(80),
    color: z.string().trim().max(7).optional(),
  })).max(50),
});

// ── Scheduled Report schemas ──
export const createScheduledReportSchema = z.object({
  name: requiredString.max(200),
  report_type: z.enum(['pipeline', 'revenue', 'contacts', 'deals', 'tickets', 'activities']),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']),
  format: z.enum(['csv', 'pdf', 'json']).optional().default('csv'),
  recipients: z.array(z.string().email()).min(1, 'At least one recipient required'),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  is_active: z.boolean().optional().default(true),
});

export const updateScheduledReportSchema = createScheduledReportSchema.partial();

// ── Tenant settings schemas ──
export const updateTenantSettingsSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  domain: z.string().max(255).optional().nullable(),
  logo_url: z.string().max(500).optional().nullable().or(z.literal('')).transform(v => {
    if (!v) return v;
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    return `https://${v}`;
  }),
  primary_color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().nullable(),
  timezone: z.string().trim().max(50).nullable().optional(),
  currency: z.string().length(3).optional(),
  date_format: z.string().trim().max(20).nullable().optional(),
  time_format: z.enum(['12h', '24h']).optional(),
});

// ── IP Whitelist schema ──
export const ipWhitelistSchema = z.object({
  ips: z.array(z.string().regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, 'Invalid IP address')).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

// ── Email Warmup Config schema ──
export const emailWarmupConfigSchema = z.object({
  from_email: z.string().email('Invalid from email'),
  from_name: z.string().trim().max(200).optional().default(''),
  daily_limit_start: z.coerce.number().int().min(1).max(1000).optional().default(5),
  daily_limit_max: z.coerce.number().int().min(1).max(10000).optional().default(50),
  ramp_up_days: z.coerce.number().int().min(1).max(90).optional().default(21),
  participants: z.array(z.object({
    email: z.string().email(),
    name: z.string().trim().max(200).optional().default(''),
  })).optional().default([]),
});

// ── Email Test schema ──
export const testEmailSchema = z.object({
  to: z.string().email('Invalid recipient email'),
  provider: z.string().trim().max(50).optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

// ── Role schemas ──
export const createRoleSchema = z.object({
  name: requiredString.max(100, 'Role name too long'),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
});

export const updateRoleSchema = createRoleSchema.partial();

// ── AI Providers schema ──
export const updateAiProvidersSchema = z.object({
  providers: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    default_model: z.string().trim().max(100).optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
    max_tokens: z.coerce.number().int().min(1).max(100000).optional(),
    fallback_priority: z.coerce.number().int().min(0).optional(),
    api_key: z.string().min(1).optional(),
    base_url: z.string().url().optional().nullable(),
  }).passthrough()),
});

// ── AI Template schemas ──
export const createAiTemplateSchema = z.object({
  slug: z.string().trim().max(100).optional(),
  name: requiredString.max(200, 'Name too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: requiredString.max(50),
  entity_types: z.array(z.string()).optional().default([]),
  system_prompt: requiredString,
  user_prompt: requiredString,
  tone: z.string().trim().max(100).optional().nullable(),
  default_subject: z.string().trim().max(200).optional().nullable(),
  active: z.boolean().optional().default(true),
});

// ── Lead Scoring schemas ──
export const createLeadScoringRuleSchema = z.object({
  factor: requiredString.max(100, 'Factor name too long'),
  weight: z.coerce.number().int().min(0).max(1000).default(1),
  condition: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const updateLeadScoringRuleSchema = createLeadScoringRuleSchema.partial();

// ── Type exports ──
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateScheduledReportInput = z.infer<typeof createScheduledReportSchema>;
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
export type IpWhitelistInput = z.infer<typeof ipWhitelistSchema>;
export type EmailWarmupConfigInput = z.infer<typeof emailWarmupConfigSchema>;
export type TestEmailInput = z.infer<typeof testEmailSchema>;

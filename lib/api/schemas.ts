/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';

// ── Single-source schemas ──
// These were defined here AND in the matching `lib/api/schemas/<domain>` file,
// so which validation a payload met depended on which path a route imported —
// the failure mode #1883 was filed for. The domain file holds the one definition;
// this file imports and re-exports it, so the 90+ routes still importing
// `@/lib/api/schemas` keep resolving the same objects. Pinned by
// tests/unit/schema-schemas-single-source.test.ts.
import {
  createCustomFieldSchema,
  createIntegrationSchema,
  createRoleSchema,
  createScheduledReportSchema,
  createWebhookFieldMappingSchema,
  emailWarmupConfigSchema,
  ipWhitelistSchema,
  onboardingStepSchema,
  tagActionSchema,
  testEmailSchema,
  updateCustomFieldSchema,
  updateIntegrationSchema,
  updateMemberSchema,
  updateRoleSchema,
  updateScheduledReportSchema,
  updateTenantSettingsSchema,
  updateWebhookFieldMappingSchema,
  upsertPicklistSchema,
  type CreateCustomFieldInput,
  type CreateIntegrationInput,
  type CreateScheduledReportInput,
  type EmailWarmupConfigInput,
  type IpWhitelistInput,
  type OnboardingStepInput,
  type TestEmailInput,
  type UpdateCustomFieldInput,
  type UpdateMemberInput,
  type UpdateTenantSettingsInput,
} from './schemas/admin';
import { aiAssistantSchema, type AiAssistantInput } from './schemas/ai';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setup2faSchema,
  signupSchema,
  type ChangePasswordInput,
} from './schemas/auth';
import {
  createAutomationSchema,
  createEmailTemplateSchema,
  createFormSchema,
  createSequenceSchema,
  createWebhookSchema,
  createWorkflowSchema,
  sendWhatsAppSchema,
  triggerWorkflowSchema,
  updateAutomationSchema,
  updateEmailTemplateSchema,
  updateFormSchema,
  updateSequenceSchema,
  updateWebhookSchema,
  updateWorkflowSchema,
  type CreateAutomationInput,
  type CreateSequenceInput,
  type CreateWorkflowInput,
  type SendWhatsAppInput,
  type TriggerWorkflowInput,
} from './schemas/automation';
import {
  createApiKeySchema,
  createContractSchema,
  createInvoiceSchema,
  createOrderSchema,
  createProductSchema,
  createQuoteSchema,
  createServiceSchema,
  createSubscriptionSchema,
  invoiceQuerySchema,
  updateApiKeySchema,
  updateContractSchema,
  updateInvoiceSchema,
  updateOrderSchema,
  updateProductSchema,
  updateQuoteSchema,
  updateServiceSchema,
  updateSubscriptionSchema,
  type CreateApiKeyInput,
  type CreateContractInput,
  type CreateInvoiceInput,
  type CreateOrderInput,
  type CreateProductInput,
  type CreateQuoteInput,
  type CreateServiceInput,
  type CreateSubscriptionInput,
  type UpdateInvoiceInput,
} from './schemas/billing';
import {
  bulkDeleteSchema,
  bulkUpdateSchema,
  convertLeadSchema,
  exportSchema,
  importSchema,
  mergeContactSchema,
  searchSchema,
  type BulkDeleteInput,
  type BulkUpdateInput,
  type ConvertLeadInput,
  type ExportInput,
  type ImportInput,
  type MergeContactInput,
  type SearchInput,
} from './schemas/import-export';
import {
  createMilestoneSchema,
  createProjectSchema,
  linkTaskSchema,
  updateProjectSchema,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type LinkTaskInput,
  type UpdateProjectInput,
} from './schemas/projects';
import {
  checkoutSessionSchema,
  publicFormSubmitSchema,
  publicLeadCaptureSchema,
  type CheckoutSessionInput,
  type PublicFormSubmitInput,
  type PublicLeadCaptureInput,
} from './schemas/public';
import {
  backupConfigSchema,
  createBackupSchema,
  createPlanSchema,
  createTenantSchema,
  platformSettingsSchema,
  updatePlanSchema,
  updateTenantSchema,
  type BackupConfigInput,
  type CreateBackupInput,
  type CreatePlanInput,
  type CreateTenantInput,
  type UpdatePlanInput,
  type UpdateTenantInput,
} from './schemas/superadmin';
import {
  createKbArticleSchema,
  createKbCategorySchema,
  updateKbArticleSchema,
  updateKbCategorySchema,
  type CreateKbArticleInput,
  type CreateKbCategoryInput,
} from './schemas/support';
import {
  preferencesPatchSchema,
  updateNotificationPrefsSchema,
  updateProfileSchema,
  updateTelegramSchema,
  type UpdateProfileInput,
  type UpdateTelegramInput,
} from './schemas/user';

// ── Common helpers ──
const uuid = uuidIdSchema.optional().nullable().or(z.literal(''));
const _optionalString = z.string().trim();
const requiredString = z.string().trim().min(1);
const _optionalDate = z.string().datetime().optional().nullable();
const _optionalNumber = z.number().optional().nullable();

// Accept URLs with or without protocol — auto-prepend https://
const urlField = z.string().max(500).optional().nullable().or(z.literal('')).transform(v => {
  if (!v) return v;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return `https://${v}`;
});

// ── Contact schemas ──
export const createContactSchema = z.object({
  first_name: requiredString.max(100, 'First name too long'),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email('Invalid email').max(255).optional().nullable().or(z.literal('')),
  phone: z.string().max(30).optional().nullable(),
  job_title: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  company_id: uuid,
  lead_status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'archived', 'disqualified', 'unqualified', 'converted']).optional().nullable(),
  lead_source: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  score: z.coerce.number().int().min(0).max(1000).optional().default(0),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  website: urlField,
  linkedin_url: urlField,
  twitter_url: urlField,
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  assigned_to: uuid,
});

export const updateContactSchema = createContactSchema.partial();

export const contactQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  lead_status: z.string().optional(),
  company_id: uuidIdSchema.optional().or(z.literal('')),
});

// ── Deal schemas ──
export const createDealSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  amount: z.coerce.number().min(0).optional().default(0),
  value: z.coerce.number().min(0).optional(),
  stage_id: uuid,
  stage: z.string().max(50).optional(),
  stage_name: z.string().max(50).optional(),
  pipeline_id: uuid,
  close_date: z.string().date().optional().nullable(),
  contact_id: uuid,
  company_id: uuid,
  assigned_to: uuid,
  description: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

// #2627: `.partial()` inherits `.default()`, so a PATCH body that omitted
// `amount` used to be parsed to `{ amount: 0 }` and written back. Strip the
// defaults on the two keys that had them before partial-ing.
export const updateDealSchema = createDealSchema.extend({ amount: z.coerce.number().min(0).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).partial();

export const dealQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  stage_id: z.string().optional(),
  stage: z.string().optional(),
  pipeline_id: uuidIdSchema.optional(),
  q: z.string().optional(),
  /**
   * Archive visibility. Deals are archived by setting metadata.archived = true
   * (see the `archive` action in app/api/tenant/deals/bulk/route.ts).
   *   omitted / 'false' -> only live deals (default)
   *   'true'            -> only archived deals
   *   'all'             -> both
   */
  archived: z.enum(['true', 'false', 'all']).optional(),
});

// ── Company schemas ──
export const createCompanySchema = z.object({
  name: requiredString.max(200, 'Company name too long'),
  domain: z.string().max(255).optional().nullable(),
  industry: z.string().trim().max(100).nullable().optional(),
  size: z.string().max(50).optional().nullable(),
  annual_revenue: z.coerce.number().min(0).optional().nullable(),
  description: z.string().trim().max(2000).nullable().optional(),
  // `notes` is the memo field the companies UI (edit form, detail page, list,
  // CSV export) reads/writes. Accept it alongside `description`; the route
  // mirrors the two so the user-visible Notes never goes silently empty.
  notes: z.string().trim().max(2000).nullable().optional(),
  website: urlField,
  phone: z.string().max(30).optional().nullable(),
  billing_address: z.string().max(500).optional().nullable(),
  shipping_address: z.string().max(500).optional().nullable(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  linkedin_url: urlField,
  twitter_url: urlField,
  facebook_url: urlField,
  tags: z.array(z.string()).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  assigned_to: uuid,
});

export const updateCompanySchema = createCompanySchema.partial();

export const companyQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  industry: z.string().optional(),
});

// ── Lead schemas ──
// Canonical allowlist of lead status values. Superset of the single-lead
// `status` enum, the bulk endpoint's STATUSES allowlist, and the values the
// leads Kanban UI emits (PIPELINE_CONFIG), so every write path that touches
// leads.leadStatus is bounded to the same vocabulary.
export const LEAD_STATUS_VALUES = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
  'rejected',
  'junk',
  'archived',
  'lost',
  'nurturing',
] as const;

export const createLeadSchema = z.object({
  contact_id: uuid,
  first_name: requiredString.max(100),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email().max(255).optional().nullable().or(z.literal('')),
  phone: z.string().max(30).optional().nullable(),
  company: z.string().trim().max(200).nullable().optional(),
  job_title: z.string().trim().max(200).nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'rejected', 'junk', 'archived', 'unqualified']).optional().default('new'),
  notes: z.string().trim().max(5000).nullable().optional(),
  score: z.coerce.number().int().min(0).max(1000).optional().default(0),
  value: z.coerce.number().min(0).optional().nullable(),
  assigned_to: uuid,
  requested_product_id: uuid,
  requested_service_id: uuid,
  company_id: uuid,
  utm_source: z.string().trim().max(200).nullable().optional(),
  utm_medium: z.string().trim().max(200).nullable().optional(),
  utm_campaign: z.string().trim().max(200).nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateLeadSchema = createLeadSchema.partial();

export const leadQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  // #1083 — surface the leads data model as filters
  lead_status: z.string().trim().max(50).optional(),
  assigned_to: uuidIdSchema.optional().or(z.literal('')),
  lifecycle_stage: z.string().trim().max(50).optional(),
  // Comma-separated tag list; every provided tag must be present on the lead.
  tags: z.string().trim().max(500).optional(),
  score_min: z.coerce.number().int().min(0).max(1000).optional(),
  score_max: z.coerce.number().int().min(0).max(1000).optional(),
  sort_by: z.string().trim().max(50).optional(),
  sort_order: z.enum(['ASC', 'DESC']).optional(),
});

// ── Task schemas ──
export const createTaskSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'deferred', 'on_hold']).optional().default('pending'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  due_date: z.string().date().optional().nullable(),
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid,
  assigned_to: uuid,
  reminder_date: z.string().datetime().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

export const updateTaskSchema = createTaskSchema.partial();

export const taskQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  contact_id: uuidIdSchema.optional(),
  deal_id: uuidIdSchema.optional(),
});

// ── Ticket schemas ──
/**
 * The canonical definitions live in `./schemas/support.ts`. They are re-exported
 * here instead of duplicated because #2285 needed a real change to the create
 * contract — `support_tickets.body` is NOT NULL while `description` was optional,
 * so a schema-valid POST 500'd and the error body echoed the whole SQL statement
 * with its bound values. `description` and `body` are now both accepted and one of
 * them must carry text.
 *
 * `ticketBodyText()` is the single place that decides which name wins, so the
 * route cannot re introduce the null-into-NOT-NULL insert.
 */
export {
  createTicketSchema,
  updateTicketSchema,
  ticketQuerySchema,
  ticketBodyText,
  type CreateTicketInput,
  type UpdateTicketInput,
} from './schemas/support';

export const ticketReplySchema = z.object({
  content: requiredString.max(10000),
  is_internal: z.boolean().optional().default(false),
  attachments: z.array(z.string()).optional().default([]),
});

// ── Meeting schemas ──
export const createMeetingSchema = z.object({
  title: requiredString.max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  start_time: z.string().datetime(),
  // Optional — the route defaults it to start_time + 1h (UI may leave End blank).
  end_time: z.string().datetime().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  meeting_url: urlField,
  contact_id: uuid,
  deal_id: uuid,
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'waiting_acceptance']).optional().default('scheduled'),
  attendees: z.array(z.string()).optional().default([]),
});

export const updateMeetingSchema = createMeetingSchema.partial();

// ── Note schemas ──
// The note body accepts either `content` (canonical) or `description` (the
// wire key the contact-detail client and the integrations SDK actually send).
// Both are optional at the field level; a superRefine below requires at least
// one, and the transform normalizes the note text into `content` so route
// handlers can rely on a single field regardless of which key the caller used.
export const createNoteSchema = z.object({
  content: z.string().trim().max(10000).optional(),
  description: z.string().trim().max(10000).optional(),
  type: z.enum(['note', 'call', 'email', 'meeting', 'task', 'deal_update']).optional().default('note'),
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid,
  task_id: uuid,
  ticket_id: uuid,
  is_pinned: z.boolean().optional().default(false),
})
  .superRefine((val, ctx) => {
    const text = (val.content ?? val.description ?? '').trim();
    if (!text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content is required',
        path: ['content'],
      });
    }
  })
  .transform((val) => ({
    ...val,
    // Canonicalize: callers may send the note text as `description`; expose it
    // as `content` so downstream code reads a single field.
    content: (val.content ?? val.description ?? '').trim(),
  }));

// updateNoteSchema mirrors the note-body shape but every field is optional and
// no cross-field requirement applies (a PATCH may touch only `is_pinned`, etc).
export const updateNoteSchema = z.object({
  content: z.string().trim().max(10000).optional(),
  description: z.string().trim().max(10000).optional(),
  type: z.enum(['note', 'call', 'email', 'meeting', 'task', 'deal_update']).optional(),
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid,
  task_id: uuid,
  ticket_id: uuid,
  is_pinned: z.boolean().optional(),
});

// ── Pipeline schemas ──
export const createPipelineSchema = z.object({
  name: requiredString.max(100),
  description: z.string().trim().max(500).nullable().optional(),
  type: z.enum(['deals', 'projects', 'custom']).optional().default('deals'),
  is_active: z.boolean().optional().default(true),
});

export const updatePipelineSchema = createPipelineSchema.partial();

// ── Deal Stage schemas ──
export const createDealStageSchema = z.object({
  pipeline_id: uuidIdSchema,
  name: requiredString.max(100),
  order: z.coerce.number().int().min(0).optional().default(0),
  probability: z.coerce.number().min(0).max(100).optional().default(0),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().nullable(),
});

export const updateDealStageSchema = createDealStageSchema.partial();

// ── Member schemas ──
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128).optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  role_slug: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/, 'Invalid role').optional().default('sales_rep'),
  role_id: uuidIdSchema.optional(),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
});

// ── Superadmin user update schema (PATCH /api/superadmin/users) ──
// role/status enums MUST match the route's allowed values.
export const updateSuperadminUserSchema = z.object({
  id: uuidIdSchema,
  full_name: z.string().trim().max(200).optional().nullable(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

// ── Assign Contact schema (bulk assign) ──
export const assignContactSchema = z.object({
  contact_ids: z.array(uuidIdSchema).min(1, 'At least one contact ID required').max(500),
  assign_to: uuidIdSchema,
  reason: z.string().trim().max(500).optional().nullable(),
});

// ── Type exports ──
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
// CreateTicketInput / UpdateTicketInput are re-exported with the schemas above.
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type CreateDealStageInput = z.infer<typeof createDealStageSchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;

export type AssignContactInput = z.infer<typeof assignContactSchema>;

// ── Follow-Up schemas ──
export const createFollowUpSchema = z.object({
  title: requiredString.max(300, 'Title too long'),
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
  lead_id: uuidIdSchema.optional(),
  contact_id: uuidIdSchema.optional(),
  deal_id: uuidIdSchema.optional(),
  assigned_to: uuidIdSchema.optional(),
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

// ── Re-exports from sub-modules ──
export {
  updateAiProvidersSchema,
  createAiTemplateSchema,
  createLeadScoringRuleSchema,
  updateLeadScoringRuleSchema,
} from './schemas/admin';

export {
  createHierarchySchema,
  updateHierarchySchema,
} from './schemas/crm';

export {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  deleteAnnouncementSchema,
  setSystemKeySchema,
  updateRateLimitsSchema,
} from './schemas/superadmin';

export {
  createCustomFieldSchema,
  createIntegrationSchema,
  createRoleSchema,
  createScheduledReportSchema,
  createWebhookFieldMappingSchema,
  emailWarmupConfigSchema,
  ipWhitelistSchema,
  onboardingStepSchema,
  tagActionSchema,
  testEmailSchema,
  updateCustomFieldSchema,
  updateIntegrationSchema,
  updateMemberSchema,
  updateRoleSchema,
  updateScheduledReportSchema,
  updateTenantSettingsSchema,
  updateWebhookFieldMappingSchema,
  upsertPicklistSchema
};
export type {
  CreateCustomFieldInput,
  CreateIntegrationInput,
  CreateScheduledReportInput,
  EmailWarmupConfigInput,
  IpWhitelistInput,
  OnboardingStepInput,
  TestEmailInput,
  UpdateCustomFieldInput,
  UpdateMemberInput,
  UpdateTenantSettingsInput
};
export {
  aiAssistantSchema
};
export type {
  AiAssistantInput
};
export {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setup2faSchema,
  signupSchema
};
export type {
  ChangePasswordInput
};
export {
  createAutomationSchema,
  createEmailTemplateSchema,
  createFormSchema,
  createSequenceSchema,
  createWebhookSchema,
  createWorkflowSchema,
  sendWhatsAppSchema,
  triggerWorkflowSchema,
  updateAutomationSchema,
  updateEmailTemplateSchema,
  updateFormSchema,
  updateSequenceSchema,
  updateWebhookSchema,
  updateWorkflowSchema
};
export type {
  CreateAutomationInput,
  CreateSequenceInput,
  CreateWorkflowInput,
  SendWhatsAppInput,
  TriggerWorkflowInput
};
export {
  createApiKeySchema,
  createContractSchema,
  createInvoiceSchema,
  createOrderSchema,
  createProductSchema,
  createQuoteSchema,
  createServiceSchema,
  createSubscriptionSchema,
  invoiceQuerySchema,
  updateApiKeySchema,
  updateContractSchema,
  updateInvoiceSchema,
  updateOrderSchema,
  updateProductSchema,
  updateQuoteSchema,
  updateServiceSchema,
  updateSubscriptionSchema
};
export type {
  CreateApiKeyInput,
  CreateContractInput,
  CreateInvoiceInput,
  CreateOrderInput,
  CreateProductInput,
  CreateQuoteInput,
  CreateServiceInput,
  CreateSubscriptionInput,
  UpdateInvoiceInput
};
export {
  bulkDeleteSchema,
  bulkUpdateSchema,
  convertLeadSchema,
  exportSchema,
  importSchema,
  mergeContactSchema,
  searchSchema
};
export type {
  BulkDeleteInput,
  BulkUpdateInput,
  ConvertLeadInput,
  ExportInput,
  ImportInput,
  MergeContactInput,
  SearchInput
};
export {
  createMilestoneSchema,
  createProjectSchema,
  linkTaskSchema,
  updateProjectSchema
};
export type {
  CreateMilestoneInput,
  CreateProjectInput,
  LinkTaskInput,
  UpdateProjectInput
};
export {
  checkoutSessionSchema,
  publicFormSubmitSchema,
  publicLeadCaptureSchema
};
export type {
  CheckoutSessionInput,
  PublicFormSubmitInput,
  PublicLeadCaptureInput
};
export {
  backupConfigSchema,
  createBackupSchema,
  createPlanSchema,
  createTenantSchema,
  platformSettingsSchema,
  updatePlanSchema,
  updateTenantSchema
};
export type {
  BackupConfigInput,
  CreateBackupInput,
  CreatePlanInput,
  CreateTenantInput,
  UpdatePlanInput,
  UpdateTenantInput
};
export {
  createKbArticleSchema,
  createKbCategorySchema,
  updateKbArticleSchema,
  updateKbCategorySchema
};
export type {
  CreateKbArticleInput,
  CreateKbCategoryInput
};
export {
  preferencesPatchSchema,
  updateNotificationPrefsSchema,
  updateProfileSchema,
  updateTelegramSchema
};
export type {
  UpdateProfileInput,
  UpdateTelegramInput
};

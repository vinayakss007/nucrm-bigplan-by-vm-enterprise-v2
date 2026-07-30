import { z } from 'zod';
import { uuid, requiredString, urlField } from './common';

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
  limit: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().optional(),
  lead_status: z.string().optional(),
  company_id: z.string().uuid().optional().or(z.literal('')),
});

// ── Deal schemas ──
export const createDealSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  amount: z.coerce.number().min(0).optional().default(0),
  value: z.coerce.number().min(0).optional(),
  stage_id: uuid.optional(),
  stage: z.string().max(50).optional(),
  stage_name: z.string().max(50).optional(),
  pipeline_id: uuid.optional(),
  close_date: z.string().date().optional().nullable(),
  contact_id: uuid.optional().nullable(),
  company_id: uuid.optional().nullable(),
  assigned_to: uuid.optional().nullable(),
  description: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateDealSchema = createDealSchema.partial();

export const dealQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  stage_id: z.string().optional(),
  stage: z.string().optional(),
  pipeline_id: z.string().uuid().optional(),
  q: z.string().optional(),
  /**
   * Archive visibility. Deals are archived by setting metadata.archived = true
   * (see the `archive` action in app/api/tenant/deals/bulk/route.ts).
   *   omitted / 'false' -> only live deals (default)
   *   'true'            -> only archived deals, so they can be reviewed/unarchived
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
export const createLeadSchema = z.object({
  contact_id: uuid.optional(),
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
  // What the lead is a request for, from the tenant's catalogue. Optional.
  requested_product_id: uuid,
  requested_service_id: uuid,
  // Attach to an existing company by id (as well as, or instead of, a name).
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
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
});

// ── Meeting schemas ──
export const createMeetingSchema = z.object({
  title: requiredString.max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  location: z.string().trim().max(500).nullable().optional(),
  meeting_url: urlField,
  contact_id: uuid,
  deal_id: uuid,
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'waiting_acceptance']).optional().default('scheduled'),
  attendees: z.array(z.string()).optional().default([]),
});

export const updateMeetingSchema = createMeetingSchema.partial();

// ── Note schemas ──
export const createNoteSchema = z.object({
  content: requiredString.max(10000),
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid,
  task_id: uuid,
  ticket_id: uuid,
  is_pinned: z.boolean().optional().default(false),
});

export const updateNoteSchema = createNoteSchema.partial();

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
  pipeline_id: z.string().uuid(),
  name: requiredString.max(100),
  order: z.coerce.number().int().min(0).optional().default(0),
  probability: z.coerce.number().min(0).max(100).optional().default(0),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().nullable(),
});

export const updateDealStageSchema = createDealStageSchema.partial();

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

// ── Hierarchy schemas ──
export const createHierarchySchema = z.object({
  childTenantId: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  relationship: z.enum(['parent', 'division', 'franchise', 'branch']),
  relationship_type: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).optional().default([]),
});

export const updateHierarchySchema = createHierarchySchema.partial().extend({
  id: z.string().uuid(),
});

// ── Contact Assignment schema ──
export const assignContactSchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1, 'At least one contact required'),
  assign_to: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
  contact_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
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
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type CreateDealStageInput = z.infer<typeof createDealStageSchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;

import { z } from 'zod';

const uuid = z.string().uuid().optional().nullable().or(z.literal(''));
const requiredString = z.string().trim().min(1);

// ── Contact schemas ──
export const createContactSchema = z.object({
  firstName: requiredString.max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  leadStatus: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
  leadSource: z.string().max(200).optional(),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  assigneeId: uuid,
});

export const updateContactSchema = createContactSchema.partial();

export const contactQuerySchema = z.object({
  search: z.string().optional(),
  lead_status: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
  tag: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Lead schemas ──
export const createLeadSchema = z.object({
  first_name: requiredString.max(100),
  last_name: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  leadSource: z.string().max(200).optional(),
  leadStatus: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  assigneeId: uuid,
  pipelineId: uuid,
  dealStageId: uuid,
});

export const updateLeadSchema = createLeadSchema.partial();

export const leadQuerySchema = z.object({
  search: z.string().optional(),
  lead_status: z.string().optional(),
  pipeline_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  tag: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Deal schemas ──
export const createDealSchema = z.object({
  title: requiredString.max(200),
  value: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  stageId: uuid,
  pipelineId: uuid,
  contactId: uuid,
  companyId: uuid,
  assigneeId: uuid,
  expectedCloseDate: z.string().datetime().optional().nullable(),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateDealSchema = createDealSchema.partial();

export const dealQuerySchema = z.object({
  search: z.string().optional(),
  stage_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  min_value: z.coerce.number().optional(),
  max_value: z.coerce.number().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Company schemas ──
export const createCompanySchema = z.object({
  name: requiredString.max(200),
  domain: z.string().max(200).optional(),
  industry: z.string().max(200).optional(),
  size: z.string().max(50).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional().nullable(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  assigneeId: uuid,
});

export const updateCompanySchema = createCompanySchema.partial();

export const companyQuerySchema = z.object({
  search: z.string().optional(),
  industry: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

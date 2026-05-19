import { z } from 'zod';

// ── Common helpers ──
const uuid = z.string().uuid().optional().nullable();
const optionalString = z.string().trim();
const requiredString = z.string().trim().min(1);
const optionalDate = z.string().datetime().optional().nullable();
const optionalNumber = z.number().optional().nullable();

// ── Contact schemas ──
export const createContactSchema = z.object({
  first_name: requiredString.max(100, 'First name too long'),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email('Invalid email').max(255).optional().nullable(),
  phone: z.string().regex(/^[\d\s\-+()]{0,20}$/, 'Invalid phone').optional().nullable(),
  job_title: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  company_id: uuid,
  lead_status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']).optional().nullable(),
  lead_source: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  score: z.coerce.number().int().min(0).max(1000).optional().default(0),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  website: z.string().url().max(500).optional().nullable().or(z.literal('')),
  linkedin_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  twitter_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  assigned_to: uuid,
});

export const updateContactSchema = createContactSchema.partial();

export const contactQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  lead_status: z.string().optional(),
  company_id: z.string().uuid().optional(),
});

// ── Deal schemas ──
export const createDealSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  amount: z.coerce.number().min(0).optional().default(0),
  value: z.coerce.number().min(0).optional(),
  stage_id: uuid,
  stage: z.string().max(50).optional(),
  pipeline_id: uuid,
  close_date: z.string().date().optional().nullable(),
  contact_id: uuid,
  company_id: uuid,
  assigned_to: uuid,
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
});

// ── Company schemas ──
export const createCompanySchema = z.object({
  name: requiredString.max(200, 'Company name too long'),
  domain: z.string().max(255).optional().nullable(),
  industry: z.string().trim().max(100).nullable().optional(),
  size: z.string().max(50).optional().nullable(),
  annual_revenue: z.coerce.number().min(0).optional().nullable(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().url().max(500).optional().nullable().or(z.literal('')),
  phone: z.string().regex(/^[\d\s\-+()]{0,20}$/, 'Invalid phone').optional().nullable(),
  billing_address: z.string().max(500).optional().nullable(),
  shipping_address: z.string().max(500).optional().nullable(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  linkedin_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  twitter_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  facebook_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
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
  first_name: requiredString.max(100),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().regex(/^[\d\s\-+()]{0,20}$/, 'Invalid phone').optional().nullable(),
  company: z.string().trim().max(200).nullable().optional(),
  job_title: z.string().trim().max(200).nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'rejected']).optional().default('new'),
  notes: z.string().trim().max(5000).nullable().optional(),
  score: z.coerce.number().int().min(0).max(1000).optional().default(0),
  assigned_to: uuid,
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
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().default('pending'),
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

// ── Ticket schemas ──
export const createTicketSchema = z.object({
  subject: requiredString.max(300, 'Subject too long'),
  description: z.string().trim().max(10000).nullable().optional(),
  status: z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed']).optional().default('open'),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'critical']).optional().default('medium'),
  category: z.string().trim().max(100).nullable().optional(),
  contact_id: uuid,
  company_id: uuid,
  assigned_to: uuid,
  tags: z.array(z.string()).optional().default([]),
});

export const updateTicketSchema = createTicketSchema.partial();

export const ticketQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
});

export const ticketReplySchema = z.object({
  content: requiredString.max(10000),
  is_internal: z.boolean().optional().default(false),
  attachments: z.array(z.string()).optional().default([]),
});

// ── Invoice schemas ──
export const createInvoiceSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  issue_date: z.string().date().optional().nullable(),
  due_date: z.string().date().optional().nullable(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional().default('draft'),
  line_items: z.array(z.object({
    description: z.string().max(500),
    quantity: z.coerce.number().min(0),
    unit_price: z.coerce.number().min(0),
    tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  })).min(1, 'At least one line item required'),
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  discount: z.coerce.number().min(0).optional().default(0),
  tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

export const invoiceQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
});

// ── Quote schemas ──
export const createQuoteSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  title: requiredString.max(200),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional().default('draft'),
  issue_date: z.string().date().optional().nullable(),
  expiry_date: z.string().date().optional().nullable(),
  line_items: z.array(z.object({
    description: z.string().max(500),
    quantity: z.coerce.number().min(0),
    unit_price: z.coerce.number().min(0),
    tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  })).min(1, 'At least one line item required'),
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  discount: z.coerce.number().min(0).optional().default(0),
});

export const updateQuoteSchema = createQuoteSchema.partial();

// ── Order schemas ──
export const createOrderSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']).optional().default('pending'),
  line_items: z.array(z.object({
    description: z.string().max(500),
    quantity: z.coerce.number().min(0),
    unit_price: z.coerce.number().min(0),
  })).min(1, 'At least one line item required'),
  shipping_address: z.string().trim().max(500).nullable().optional(),
  tracking_number: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const updateOrderSchema = createOrderSchema.partial();

// ── Contract schemas ──
export const createContractSchema = z.object({
  title: requiredString.max(200),
  contact_id: uuid,
  company_id: uuid,
  type: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['draft', 'active', 'expired', 'terminated', 'renewed']).optional().default('draft'),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  value: z.coerce.number().min(0).optional().default(0),
  description: z.string().trim().max(5000).nullable().optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
});

export const updateContractSchema = createContractSchema.partial();

// ── Subscription schemas ──
export const createSubscriptionSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  service_id: uuid,
  status: z.enum(['trial', 'active', 'paused', 'cancelled', 'expired']).optional().default('trial'),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  trial_end_date: z.string().date().optional().nullable(),
  billing_frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional().default('monthly'),
  auto_renew: z.boolean().optional().default(true),
  quantity: z.coerce.number().int().min(1).optional().default(1),
});

export const updateSubscriptionSchema = createSubscriptionSchema.partial();

// ── Meeting schemas ──
export const createMeetingSchema = z.object({
  title: requiredString.max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  location: z.string().trim().max(500).nullable().optional(),
  meeting_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  contact_id: uuid,
  deal_id: uuid,
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional().default('scheduled'),
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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export const updateDealStageSchema = createDealStageSchema.partial();

// ── Automation schemas ──
export const createAutomationSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  event: requiredString.max(100),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.unknown(),
  })).optional().default([]),
  actions: z.array(z.object({
    type: z.string(),
    config: z.record(z.string(), z.unknown()),
  })).min(1, 'At least one action required'),
  is_active: z.boolean().optional().default(true),
});

export const updateAutomationSchema = createAutomationSchema.partial();

// ── Workflow schemas ──
export const createWorkflowSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  trigger_type: z.enum(['event', 'schedule', 'manual']).optional().default('event'),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  nodes: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  edges: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();

// ── Email Sequence schemas ──
export const createSequenceSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed']).optional().default('draft'),
  steps: z.array(z.object({
    type: z.enum(['email', 'task', 'wait']),
    delay_minutes: z.coerce.number().int().min(0).optional().default(0),
    template_id: uuid,
    subject: z.string().max(200).optional(),
    body: z.string().max(10000).optional(),
  })).optional().default([]),
});

export const updateSequenceSchema = createSequenceSchema.partial();

// ── Webhook schemas ──
export const createWebhookSchema = z.object({
  name: requiredString.max(200),
  url: z.string().url().max(500),
  events: z.array(z.string()).min(1, 'At least one event required'),
  secret: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(true),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

export const updateWebhookSchema = createWebhookSchema.partial();

// ── API Key schemas ──
export const createApiKeySchema = z.object({
  name: requiredString.max(100),
  scopes: z.array(z.string()).min(1, 'At least one scope required'),
  expires_at: z.string().datetime().optional().nullable(),
});

export const updateApiKeySchema = createApiKeySchema.partial();

// ── Form schemas ──
export const createFormSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  fields: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
  })).min(1, 'At least one field required'),
  is_active: z.boolean().optional().default(true),
  redirect_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  success_message: z.string().trim().max(500).nullable().optional(),
});

export const updateFormSchema = createFormSchema.partial();

// ── Email Template schemas ──
export const createEmailTemplateSchema = z.object({
  name: requiredString.max(200),
  subject: requiredString.max(200),
  body: requiredString.max(50000),
  category: z.string().trim().max(100).nullable().optional(),
  variables: z.array(z.string()).optional().default([]),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();

// ── Role schemas ──
export const createRoleSchema = z.object({
  name: requiredString.max(100),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
  is_system: z.boolean().optional().default(false),
});

export const updateRoleSchema = createRoleSchema.partial();

// ── Member schemas ──
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  role_id: z.string().uuid().optional(),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
});

// ── Bulk operation schemas ──
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
  updates: z.record(z.string(), z.unknown()),
});

// ── Export schemas ──
export const exportSchema = z.object({
  entity_type: z.enum(['contacts', 'companies', 'deals', 'leads', 'tasks', 'tickets', 'invoices']),
  format: z.enum(['csv', 'json']).optional().default('csv'),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  fields: z.array(z.string()).optional(),
});

// ── Import schemas ──
export const importSchema = z.object({
  entity_type: z.enum(['contacts', 'companies', 'deals', 'leads']),
  data: z.array(z.record(z.string(), z.unknown())).min(1, 'At least one record required').max(10000),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  skip_duplicates: z.boolean().optional().default(true),
});

// ── Search schemas ──
export const searchSchema = z.object({
  q: requiredString.max(200),
  entity_types: z.array(z.enum(['contacts', 'companies', 'deals', 'leads', 'tasks', 'tickets'])).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── KB Article schemas ──
export const createKbArticleSchema = z.object({
  title: requiredString.max(300),
  content: requiredString.max(50000),
  category_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  tags: z.array(z.string()).optional().default([]),
  order: z.coerce.number().int().min(0).optional().default(0),
  meta_description: z.string().max(300).optional().nullable(),
});

export const updateKbArticleSchema = createKbArticleSchema.partial();

// ── KB Category schemas ──
export const createKbCategorySchema = z.object({
  name: requiredString.max(100),
  description: z.string().trim().max(500).nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Invalid slug').max(100),
  parent_id: uuid,
  order: z.coerce.number().int().min(0).optional().default(0),
  is_public: z.boolean().optional().default(true),
});

export const updateKbCategorySchema = createKbCategorySchema.partial();

// ── Integration schemas ──
export const createIntegrationSchema = z.object({
  name: requiredString.max(100),
  type: requiredString.max(50),
  config: z.record(z.string(), z.unknown()),
  is_active: z.boolean().optional().default(true),
});

export const updateIntegrationSchema = createIntegrationSchema.partial();

// ── Service schemas ──
export const createServiceSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  hourly_rate: z.coerce.number().min(0).optional().default(0),
  monthly_rate: z.coerce.number().min(0).optional().default(0),
  yearly_rate: z.coerce.number().min(0).optional().default(0),
  category: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

export const updateServiceSchema = createServiceSchema.partial();

// ── Product schemas ──
export const createProductSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  price: z.coerce.number().min(0).optional().default(0),
  cost: z.coerce.number().min(0).optional().default(0),
  tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  category: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

export const updateProductSchema = createProductSchema.partial();

// ── 2FA schemas ──
export const setup2faSchema = z.object({
  password: requiredString.min(8),
});

export const verify2faSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Invalid TOTP token'),
  password: requiredString.min(8),
});

export const disable2faSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Invalid TOTP token'),
  password: requiredString.min(8),
});

// ── Notification preference schemas ──
export const updateNotificationPrefsSchema = z.object({
  email_notifications: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  notification_frequency: z.enum(['instant', 'hourly', 'daily', 'weekly']).optional(),
  notify_on_contact_created: z.boolean().optional(),
  notify_on_deal_won: z.boolean().optional(),
  notify_on_ticket_created: z.boolean().optional(),
  notify_on_task_due: z.boolean().optional(),
});

// ── Password change schema ──
export const changePasswordSchema = z.object({
  current_password: requiredString.min(1),
  new_password: requiredString.min(8, 'Password must be at least 8 characters'),
});

// ── Profile update schema ──
export const updateProfileSchema = z.object({
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  avatar_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  timezone: z.string().trim().max(50).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional(),
});

// ── Tenant settings schemas ──
export const updateTenantSettingsSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  domain: z.string().max(255).optional().nullable(),
  logo_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  timezone: z.string().trim().max(50).nullable().optional(),
  currency: z.string().length(3).optional(),
  date_format: z.string().trim().max(20).nullable().optional(),
  time_format: z.enum(['12h', '24h']).optional(),
});

// ── Scheduled report schemas ──
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
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type CreateDealStageInput = z.infer<typeof createDealStageSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type ExportInput = z.infer<typeof exportSchema>;
export type ImportInput = z.infer<typeof importSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type CreateKbArticleInput = z.infer<typeof createKbArticleSchema>;
export type CreateKbCategoryInput = z.infer<typeof createKbCategorySchema>;
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
export type CreateScheduledReportInput = z.infer<typeof createScheduledReportSchema>;

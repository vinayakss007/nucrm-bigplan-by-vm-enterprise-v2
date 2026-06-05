import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, decimal, integer, boolean, index, primaryKey, bigint, date, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import * as utils from './utils';

// ── 1. CRM MODULE ─────────────────────────────────────
export const companies = pgTable('companies', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  name: text('name').notNull(),
  domain: text('domain'),
  industry: text('industry'),
  companySize: text('company_size'),
  annualRevenue: decimal('annual_revenue', { precision: 15, scale: 2 }),
  foundedYear: integer('founded_year'),
  headquarters: text('headquarters'),
  description: text('description'),
  
  website: text('website'),
  logoUrl: text('logo_url'),
  phone: text('phone'),
  address: text('address'),
  addressLine1: text('address_line1'),
  city: text('city'),
  state: text('state'),
  country: text('country'),
  postalCode: text('postal_code'),
  timezone: text('timezone'),
  
  linkedinUrl: text('linkedin_url'),
  twitterUrl: text('twitter_url'),
  facebookUrl: text('facebook_url'),
  
  isCustomer: boolean('is_customer').default(false),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  
  notes: text('notes'),
  tags: text('tags').array().default(sql`'{}'`),
  customFields: jsonb('custom_fields').default({}),
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    nameIdx: index('idx_companies_name').on(table.name),
    domainIdx: index('idx_companies_domain').on(table.domain),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
    searchIdx: index('idx_companies_search').using('gin', sql`to_tsvector('english', ${table.name} || ' ' || COALESCE(${table.domain}, ''))`),
  };
});

export const contacts = pgTable('contacts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  originalOwnerId: uuid('original_owner_id').references(() => users.id, { onDelete: 'set null' }),
  
  firstName: text('first_name').notNull(),
  lastName: text('last_name').default(''),
  email: text('email'),
  secondaryEmail: text('secondary_email'),
  phone: text('phone'),
  mobilePhone: text('mobile_phone'),
  workPhone: text('work_phone'),
  
  jobTitle: text('job_title'),
  department: text('department'),
  
  address: text('address'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  country: text('country'),
  postalCode: text('postal_code'),
  timezone: text('timezone'),
  
  birthday: date('birthday'),
  gender: text('gender'),
  
  avatarUrl: text('avatar_url'),
  linkedinUrl: text('linkedin_url'),
  twitterUrl: text('twitter_url'),
  facebookUrl: text('facebook_url'),
  instagramUrl: text('instagram_url'),
  website: text('website'),
  
  leadSource: text('lead_source'),
  leadStatus: text('lead_status').default('new'),
  lifecycleStage: text('lifecycle_stage').default('subscriber'),
  score: integer('score').default(0),
  
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  timesContacted: integer('times_contacted').default(0),
  lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
  
  doNotContact: boolean('do_not_contact').default(false),
  unsubscribed: boolean('unsubscribed').default(false),
  isArchived: boolean('is_archived').default(false),
  isCustomer: boolean('is_customer').default(false),
  
  leadAccess: text('lead_access').default('team'),
  ownerNotes: text('owner_notes'),
  notes: text('notes'),
  tags: text('tags').array().default(sql`'{}'`),
  customFields: jsonb('custom_fields').default({}),
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    companyIdx: index('idx_contacts_company').on(table.companyId),
    emailIdx: index('idx_contacts_email').on(table.tenantId, table.email),
    tenantStatusIdx: index('idx_contacts_tenant_status').on(table.tenantId, table.leadStatus),
    assignedIdx: index('idx_contacts_assigned').on(table.assignedTo),
    tenantCreatedIdx: index('idx_contacts_tenant_created').on(table.tenantId, table.createdAt),
    activeIdx: utils.activeIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    searchIdx: index('idx_contacts_search').using('gin', sql`to_tsvector('english', ${table.firstName} || ' ' || COALESCE(${table.lastName}, '') || ' ' || COALESCE(${table.email}, ''))`),
  };
});

// ── 2. LEADS MODULE (Raw/Unqualified) ─────────────────
export const leads = pgTable('leads', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull().default(''),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  companyName: text('company_name'),
  source: text('lead_source'),
  leadStatus: text('lead_status').notNull().default('new'),
  score: integer('score').notNull().default(0),
  value: decimal('value', { precision: 12, scale: 2 }),
  budget: decimal('budget', { precision: 12, scale: 2 }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  
  title: text('title'),
  website: text('website'),
  mobile: text('mobile'),
  address: text('address'),
  addressLine1: text('address_line1'),
  city: text('city'),
  state: text('state'),
  country: text('country'),
  postalCode: text('postal_code'),
  
  companySize: text('company_size'),
  companyIndustry: text('company_industry'),
  lifecycleStage: text('lifecycle_stage').default('lead'),
  budgetCurrency: text('budget_currency').default('USD'),
  authorityLevel: text('authority_level').default('unknown'),
  needDescription: text('need_description'),
  timeline: text('timeline'),
  timelineTargetDate: date('timeline_target_date'),
  
  linkedinUrl: text('linkedin_url'),
  twitterHandle: text('twitter_handle'),
  
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  formId: text('form_id'),
  formSubmissionsCount: integer('form_submissions_count').default(0),
  customFields: jsonb('custom_fields').default({}),
  
  tags: text('tags').array().notNull().default(sql`'{}'`),
  
  isArchived: boolean('is_archived').notNull().default(false),
  isConverted: boolean('is_converted').notNull().default(false),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  convertedContactId: uuid('converted_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    emailIdx: index('idx_leads_email').on(table.email),
    tenantStatusIdx: index('idx_leads_tenant_status').on(table.tenantId, table.leadStatus),
    assignedIdx: index('idx_leads_assigned').on(table.assignedTo),
    tenantCreatedIdx: index('idx_leads_tenant_created').on(table.tenantId, table.createdAt),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 3. SALES MODULE ───────────────────────────────────
export const pipelines = pgTable('pipelines', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').default(false),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const dealStages = pgTable('deal_stages', {
  id: utils.pk(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  order: integer('order').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    pipelineIdx: index('idx_deal_stages_pipeline').on(table.pipelineId, table.order),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const deals = pgTable('deals', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'set null' }),
  stageId: uuid('stage_id').notNull().references(() => dealStages.id),
  stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).defaultNow(),
  
  title: text('title').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).default('0'),
  closeDate: timestamp('close_date', { withTimezone: true }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_deals_contact').on(table.contactId),
    stageIdx: index('idx_deals_stage').on(table.stageId),
    tenantStageIdx: index('idx_deals_tenant_stage').on(table.tenantId, table.stageId),
    assignedIdx: index('idx_deals_assigned').on(table.assignedTo),
    closeDateIdx: index('idx_deals_close_date').on(table.closeDate),
    tenantCreatedIdx: index('idx_deals_tenant_created').on(table.tenantId, table.createdAt),
    activeIdx: utils.activeIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 4. EXTENSIBILITY (CUSTOM FIELDS & FORMS) ──────────
export const customFieldDefs = pgTable('custom_field_defs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'lead', 'task'
  fieldKey: text('field_key').notNull(),
  fieldLabel: text('field_label').notNull(),
  fieldType: text('field_type').notNull().default('text'),
  fieldOptions: jsonb('field_options'),
  isRequired: boolean('is_required').default(false),
  isSearchable: boolean('is_searchable').default(true),
  defaultValue: text('default_value'),
  displayOrder: integer('display_order').default(0),
  isCalculated: boolean('is_calculated').default(false),
  formula: text('formula'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantEntityIdx: index('idx_custom_fields_tenant_entity').on(table.tenantId, table.entityType),
    fieldKeyIdx: index('idx_custom_fields_key').on(table.fieldKey),
    uniqueKey: uniqueIndex('idx_custom_fields_unique_key').on(table.tenantId, table.entityType, table.fieldKey),
  };
});

// Alias for compatibility if needed, but better to use the new name
export const customFields = customFieldDefs;

export const forms = pgTable('forms', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  title: text('title'),
  description: text('description'),
  fields: jsonb('fields').notNull().default([]),
  settings: jsonb('settings').default({}),
  successMessage: text('success_message'),
  redirectUrl: text('redirect_url'),
  submitLabel: text('submit_label').default('Submit'),
  theme: jsonb('theme').default({}),
  isActive: boolean('is_active').default(true),
  submissionsCount: integer('submissions_count').default(0),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
    slugIdx: uniqueIndex('idx_forms_slug').on(table.slug),
  };
});

// ── 5. PRODUCTS & QUOTES ─────────────────────────────
export const products = pgTable('products', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku'),
  basePrice: decimal('base_price', { precision: 12, scale: 2 }).default('0'),
  
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const quotes = pgTable('quotes', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  
  title: text('title').notNull(),
  quoteNumber: text('quote_number'),
  status: text('status').notNull().default('draft'), // 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'
  subtotal: decimal('subtotal', { precision: 15, scale: 2 }).default('0'),
  discount: decimal('discount', { precision: 15, scale: 2 }).default('0'),
  tax: decimal('tax', { precision: 15, scale: 2 }).default('0'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).default('0'),
  
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  notes: text('notes'),
  terms: text('terms'),
  metadata: utils.metadata(),
  
  sentAt: timestamp('sent_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  declinedAt: timestamp('declined_at', { withTimezone: true }),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    dealIdx: index('idx_quotes_deal').on(table.dealId),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const quoteLineItems = pgTable('quote_line_items', {
  id: utils.pk(),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 15, scale: 4 }).notNull().default('1'),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  taxPercent: decimal('tax_percent', { precision: 5, scale: 2 }).default('0'),
  total: decimal('total', { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    quoteIdx: index('idx_quote_line_items_quote').on(table.quoteId),
  };
});

// ── 24. PRICE BOOKS ──────────────────────────────────
export const priceBooks = pgTable('price_books', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  currency: text('currency').notNull().default('USD'),
  isActive: boolean('is_active').notNull().default(true),
  validFrom: date('valid_from'),
  validUntil: date('valid_until'),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table).where(sql`is_active = true`),
  };
});

export const priceBookEntries = pgTable('price_book_entries', {
  id: utils.pk(),
  priceBookId: uuid('price_book_id').notNull().references(() => priceBooks.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueEntry: uniqueIndex('idx_price_book_entries_unique').on(table.priceBookId, table.productId),
  };
});

// ── 25. PIPELINE HEALTH ──────────────────────────────
export const pipelineHealthMetrics = pgTable('pipeline_health_metrics', {
  id: utils.pk(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  metricDate: date('metric_date').notNull(),
  totalDeals: integer('total_deals').notNull().default(0),
  totalValue: numeric('total_value', { precision: 15, scale: 2 }).notNull().default('0'),
  avgDealSize: numeric('avg_deal_size', { precision: 15, scale: 2 }),
  winRate: numeric('win_rate', { precision: 5, scale: 4 }),
  avgCycleDays: integer('avg_cycle_days'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueMetric: uniqueIndex('idx_pipeline_health_unique').on(table.pipelineId, table.metricDate),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 6. ORGANIZATIONAL TAGS ────────────────────────────
export const tags = pgTable('tags', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  color: text('color'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// Polymorphic tagging system (Systematic)
export const entityTags = pgTable('entity_tags', {
  tenantId: utils.tenantId(),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'lead'
  entityId: uuid('entity_id').notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.tagId, table.entityId] }),
    entityIdx: index('idx_entity_tags_lookup').on(table.entityType, table.entityId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// Legacy Aliases (Legacy/Ad-hoc compatibility)
export const contactTags = pgTable('contact_tags', {
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.contactId, table.tagId] }),
  };
});

export const leadTags = pgTable('lead_tags', {
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.leadId, table.tagId] }),
  };
});

// ── 7. NOTES (General notes on entities) ─────────────
export const notes = pgTable('notes', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'lead'
  entityId: uuid('entity_id').notNull(),
  content: text('content'),
  ...utils.audit(),
}, (table) => {
  return {
    entityIdx: index('idx_notes_entity').on(table.entityType, table.entityId, table.createdAt),
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 8. DEAL PRODUCTS (Products attached to deals) ──────
export const dealProducts = pgTable('deal_products', {
  id: utils.pk(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  productName: text('product_name').notNull(),
  description: text('description'),
  quantity: integer('quantity').default(1),
  price: decimal('price', { precision: 12, scale: 2 }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    dealIdx: index('idx_deal_products_deal').on(table.dealId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 9. FORM SUBMISSIONS ──────────────────────────────
export const formSubmissions = pgTable('form_submissions', {
  id: utils.pk(),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  data: jsonb('data').default({}),
  contactId: uuid('contact_id').references(() => contacts.id),
  submittedBy: text('submitted_by'),
  sourceUrl: text('source_url'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    formIdx: index('idx_form_submissions_form').on(table.formId, table.createdAt),
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_form_submissions_contact').on(table.contactId).where(sql`contact_id IS NOT NULL`),
  };
});

// ── 10. CONTACT EMAILS ────────────────────────────────
export const contactEmails = pgTable('contact_emails', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  phone: text('phone'),
  isPrimary: boolean('is_primary').default(false),
  ...utils.lifecycle(),
}, (table) => {
  return {
    contactIdx: index('idx_contact_emails_contact').on(table.contactId),
    emailUniqueIdx: uniqueIndex('idx_contact_emails_unique').on(table.contactId, table.email),
  };
});

// ── 11. CONTACT LIFECYCLE HISTORY ───────────────────
export const contactLifecycleHistory = pgTable('contact_lifecycle_history', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  fromStage: text('from_stage'),
  toStage: text('to_stage').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  reason: text('reason'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    contactIdx: index('idx_contact_lifecycle_history_contact').on(table.contactId, table.changedAt),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 12. CONTACT MERGE HISTORY ─────────────────────────
export const contactMergeHistory = pgTable('contact_merge_history', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  primaryContactId: uuid('primary_contact_id').notNull().references(() => contacts.id),
  mergedContactId: uuid('merged_contact_id').notNull().references(() => contacts.id),
  mergedFields: jsonb('merged_fields').default({}),
  mergedBy: uuid('merged_by').references(() => users.id),
  mergedAt: timestamp('merged_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    primaryIdx: index('idx_contact_merge_history_primary').on(table.primaryContactId, table.mergedAt),
    mergedIdx: index('idx_contact_merge_history_merged').on(table.mergedContactId, table.mergedAt),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 13. CONTACT SCORES ─────────────────────────────────
export const contactScores = pgTable('contact_scores', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }).unique(),
  tenantId: utils.tenantId(),
  overallScore: integer('overall_score').default(0),
  engagementScore: integer('engagement_score').default(0),
  fitScore: integer('fit_score').default(0),
  intentScore: integer('intent_score').default(0),
  scoreFactors: jsonb('score_factors').default([]),
  lastCalculatedAt: timestamp('last_calculated_at', { withTimezone: true }).defaultNow(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_contact_scores_contact').on(table.contactId),
  };
});

// ── 14. DEAL FORECASTS ────────────────────────────────
export const dealForecasts = pgTable('deal_forecasts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  winProbability: numeric('win_probability', { precision: 5, scale: 2 }).default('0'),
  predictedCloseDate: date('predicted_close_date'),
  predictedValue: numeric('predicted_value', { precision: 12, scale: 2 }),
  positiveFactors: jsonb('positive_factors').default([]),
  negativeFactors: jsonb('negative_factors').default([]),
  originalValue: numeric('original_value', { precision: 12, scale: 2 }),
  valueChange: numeric('value_change', { precision: 12, scale: 2 }),
  originalCloseDate: date('original_close_date'),
  dateChangeDays: integer('date_change_days'),
  confidenceLevel: text('confidence_level'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    dealIdx: index('idx_deal_forecasts_deal').on(table.dealId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 15. FILE ATTACHMENTS ──────────────────────────────
export const fileAttachments = pgTable('file_attachments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  ...utils.lifecycle(),
}, (table) => {
  return {
    entityIdx: index('idx_file_attachments_entity').on(table.entityType, table.entityId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 16. LEAD ACTIVITIES ──────────────────────────────
export const leadActivities = pgTable('lead_activities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  
  performedBy: uuid('performed_by').references(() => users.id, { onDelete: 'set null' }),
  activityType: text('activity_type').notNull(),
  description: text('description'),
  subject: text('subject'),
  body: text('body'),
  
  activityData: jsonb('activity_data').default({}),
  metadata: utils.metadata(),
  
  performedAt: timestamp('performed_at', { withTimezone: true }).defaultNow(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 10. CONTACT EMAILS ────────────────────────────────

// ── 17. LEAD ASSIGNMENTS ──────────────────────────────
export const leadAssignments = pgTable('lead_assignments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    leadIdx: index('idx_lead_assignments_lead').on(table.leadId),
    contactIdx: index('idx_lead_assignments_contact').on(table.contactId),
    userIdx: index('idx_lead_assignments_user').on(table.userId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 18. PIPELINE STAGES ──────────────────────────────
export const pipelineStages = pgTable('pipeline_stages', {
  id: utils.pk(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  order: integer('order_val').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    pipelineIdx: index('idx_pipeline_stages_pipeline').on(table.pipelineId, table.order),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 19. MEETINGS ────────────────────────────────────────
export const meetings = pgTable('meetings', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  status: text('status').notNull().default('scheduled'),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    userIdx: index('idx_meetings_user').on(table.userId),
    contactIdx: index('idx_meetings_contact').on(table.contactId),
    dealIdx: index('idx_meetings_deal').on(table.dealId),
    statusIdx: index('idx_meetings_status').on(table.status),
    startTimeIdx: index('idx_meetings_start_time').on(table.startTime),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 20. CHURN PREDICTIONS ────────────────────────────
export const churnPredictions = pgTable('churn_predictions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  churnProbability: numeric('churn_probability', { precision: 5, scale: 2 }).default('0'),
  churnRisk: text('churn_risk'),
  riskFactors: jsonb('risk_factors').default([]),
  recommendedActions: text('recommended_actions').array(),
  previousProbability: numeric('previous_probability', { precision: 5, scale: 2 }),
  probabilityChange: numeric('probability_change', { precision: 5, scale: 2 }),
  isActioned: boolean('is_actioned').default(false),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_churn_predictions_contact').on(table.contactId),
  };
});

// ── 21. LEAD SCORING RULES ───────────────────────────
// ── 22. CONVERSATION INTELLIGENCE ─────────────────────
export const callNotes = pgTable('call_notes', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  callId: text('call_id'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  summary: text('summary'),
  notes: text('notes'),
  actionItems: text('action_items').array(),
  sentiment: text('sentiment'),
  durationSeconds: integer('duration_seconds'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    contactIdx: index('idx_call_notes_contact').on(table.tenantId, table.contactId, table.createdAt),
    tenantIdx: utils.tenantIdx(table),
  };
});

export const callRecordings = pgTable('call_recordings', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  recordingId: text('recording_id'),
  callSid: text('call_sid'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),
  durationSeconds: integer('duration_seconds'),
  direction: text('direction'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});

export const conversationMetrics = pgTable('conversation_metrics', {
  id: utils.pk(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  totalCalls: integer('total_calls').notNull().default(0),
  totalDurationSeconds: integer('total_duration_seconds').notNull().default(0),
  avgDurationSeconds: numeric('avg_duration_seconds', { precision: 10, scale: 2 }).notNull().default('0'),
  lastCallAt: timestamp('last_call_at', { withTimezone: true }),
  sentimentScore: numeric('sentiment_score', { precision: 5, scale: 4 }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    contactIdx: index('idx_conv_metrics_contact').on(table.contactId),
    tenantIdx: utils.tenantIdx(table),
  };
});

export const conversationKeywords = pgTable('conversation_keywords', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  keyword: text('keyword').notNull(),
  category: text('category'),
  count: integer('count').notNull().default(0),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantCountIdx: index('idx_conv_keywords_tenant').on(table.tenantId, table.count),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 23. REVENUE PROJECTIONS ──────────────────────────
export const revenueProjections = pgTable('revenue_projections', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  projectedAmount: numeric('projected_amount', { precision: 15, scale: 2 }).notNull(),
  actualAmount: numeric('actual_amount', { precision: 15, scale: 2 }).default('0'),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantPeriodIdx: index('idx_rev_projections_tenant').on(table.tenantId, table.periodStart),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 24. SAVED VIEWS ──────────────────────────────────
export const savedViews = pgTable('saved_views', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull(),
  filters: jsonb('filters').notNull().default({}),
  columns: jsonb('columns'),
  isShared: boolean('is_shared').default(false),
  isDefault: boolean('is_default').default(false),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityTypeTenantIdx: index('idx_saved_views_entity_tenant').on(table.entityType, table.tenantId),
  };
});

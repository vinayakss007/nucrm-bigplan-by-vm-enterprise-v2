import { z } from 'zod';
import { uuid, requiredString } from './common';

// ── Invoice schemas ──
export const createInvoiceSchema = z.object({
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid.optional().nullable(),
  title: requiredString.max(200, 'Title too long'),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'partially_paid', 'written_off', 'pending']).optional().default('draft'),
  currency: z.string().trim().max(3).nullable().optional(),
  tax_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  discount: z.coerce.number().min(0).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed']).optional().nullable(),
  discount_value: z.coerce.number().min(0).optional().nullable(),
  terms: z.string().trim().max(10000).nullable().optional(),
  issue_date: z.string().date().optional().nullable(),
  due_date: z.string().date().optional().nullable(),
  notes: z.string().trim().max(2000).nullable().optional(),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  sent_to: z.string().email().optional().nullable(),
  billing_address: z.string().max(500).optional().nullable(),
  shipping_address: z.string().max(500).optional().nullable(),
  purchase_order_number: z.string().trim().max(100).nullable().optional(),
  line_items: z.array(z.object({
    product_id: uuid.optional(),
    name: requiredString,
    description: z.string().trim().max(1000).optional().nullable(),
    quantity: z.coerce.number().int().min(1).default(1),
    unit_price: z.coerce.number().min(0),
    total: z.coerce.number().min(0).optional(),
    tax_amount: z.coerce.number().min(0).optional().nullable(),
    discount_amount: z.coerce.number().min(0).optional().nullable(),
  })).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

export const invoiceQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

// ── Quote schemas ──
export const createQuoteSchema = z.object({
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid.optional().nullable(),
  title: requiredString.max(200, 'Title too long'),
  status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'pending', 'expired_pending', 'converted']).optional().default('draft'),
  currency: z.string().trim().max(3).nullable().optional(),
  tax_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  discount: z.coerce.number().min(0).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed']).optional().nullable(),
  discount_value: z.coerce.number().min(0).optional().nullable(),
  terms: z.string().trim().max(10000).nullable().optional(),
  issue_date: z.string().date().optional().nullable(),
  expiry_date: z.string().date().optional().nullable(),
  notes: z.string().trim().max(2000).nullable().optional(),
  billing_address: z.string().max(500).optional().nullable(),
  shipping_address: z.string().max(500).optional().nullable(),
  purchase_order_number: z.string().trim().max(100).nullable().optional(),
  line_items: z.array(z.object({
    product_id: uuid.optional(),
    name: requiredString,
    description: z.string().trim().max(1000).optional().nullable(),
    quantity: z.coerce.number().int().min(1).default(1),
    unit_price: z.coerce.number().min(0),
    total: z.coerce.number().min(0).optional(),
    tax_amount: z.coerce.number().min(0).optional().nullable(),
    discount_amount: z.coerce.number().min(0).optional().nullable(),
  })).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateQuoteSchema = createQuoteSchema.partial();

export const quoteQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

// ── Order schemas ──
export const createOrderSchema = z.object({
  contact_id: uuid,
  deal_id: uuid,
  invoice_id: uuid,
  company_id: uuid.optional().nullable(),
  title: requiredString.max(200, 'Title too long'),
  status: z.enum(['draft', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'on_hold', 'pending_fulfillment', 'awaiting_stock', 'pending_approval']).optional().default('draft'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  currency: z.string().trim().max(3).nullable().optional(),
  tax_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed']).optional().nullable(),
  discount_value: z.coerce.number().min(0).optional().nullable(),
  estimated_delivery: z.string().date().optional().nullable(),
  actual_delivery: z.string().date().optional().nullable(),
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(10000).nullable().optional(),
  internal_notes: z.string().trim().max(2000).nullable().optional(),
  shipping_address: z.string().max(500).optional().nullable(),
  tracking_number: z.string().trim().max(200).nullable().optional(),
  line_items: z.array(z.object({
    product_id: uuid.optional(),
    name: requiredString,
    description: z.string().trim().max(1000).optional().nullable(),
    quantity: z.coerce.number().int().min(1).default(1),
    unit_price: z.coerce.number().min(0),
    total: z.coerce.number().min(0).optional(),
    tax_amount: z.coerce.number().min(0).optional().nullable(),
  })).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateOrderSchema = createOrderSchema.partial();

export const orderQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

// ── Subscription schemas ──
export const createSubscriptionSchema = z.object({
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid.optional().nullable(),
  title: requiredString.max(200),
  status: z.enum(['active', 'trialing', 'paused', 'past_due', 'cancelled', 'expired', 'in_grace_period', 'on_hold', 'pending', 'suspended']).optional().default('active'),
  currency: z.string().trim().max(3).nullable().optional(),
  billing_cycle: z.enum(['monthly', 'quarterly', 'annual', 'weekly', 'semi_annual', 'one_time', 'usage_based']).optional().default('monthly'),
  billing_frequency: z.enum(['monthly', 'quarterly', 'annual', 'weekly', 'semi_annual', 'one_time', 'usage_based']).optional().nullable(),
  amount: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(1).optional().default(1),
  auto_renew: z.boolean().optional().default(false),
  tax_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  next_billing_date: z.string().date().optional().nullable(),
  trial_end_date: z.string().date().optional().nullable(),
  cancel_at: z.string().date().optional().nullable(),
  notes: z.string().trim().max(2000).nullable().optional(),
  payment_method: z.string().trim().max(100).nullable().optional(),
  payment_provider_subscription_id: z.string().trim().max(200).nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateSubscriptionSchema = createSubscriptionSchema.partial();

export const subscriptionQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

// ── Contract schemas ──
export const createContractSchema = z.object({
  contact_id: uuid,
  deal_id: uuid,
  company_id: uuid.optional().nullable(),
  title: requiredString.max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  value: z.coerce.number().min(0),
  status: z.enum(['draft', 'pending_approval', 'active', 'expired', 'terminated', 'under_review', 'suspended', 'cancelled', 'renewed', 'completed', 'pending_signature', 'amendment_pending']).optional().default('draft'),
  type: z.enum(['service', 'nda', 'sla', 'partnership', 'employment', 'vendor', 'non_compete', 'licensing', 'consulting', 'master_service', 'statement_of_work', 'amendment', 'end_user_license']).optional().nullable(),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  renewal_date: z.string().date().optional().nullable(),
  auto_renew: z.boolean().optional().default(false),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(10000).nullable().optional(),
  signed_by: z.string().trim().max(200).nullable().optional(),
  signed_at: z.string().datetime().nullable().optional(),
  assigned_to: uuid,
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateContractSchema = createContractSchema.partial();

export const contractQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

// ── Service schemas (original) ──
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

// ── Product schemas (original) ──
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

// ── API Key schemas (original) ──
export const createApiKeySchema = z.object({
  name: requiredString.max(100),
  scopes: z.array(z.string()).min(1, 'At least one scope required'),
  expires_at: z.string().datetime().optional().nullable(),
});

export const updateApiKeySchema = createApiKeySchema.partial();

// ── Type exports ──
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

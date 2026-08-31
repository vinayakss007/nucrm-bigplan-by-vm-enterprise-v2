/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuid, requiredString } from './common';

// ── Invoice schemas ──
export const createInvoiceSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  issue_date: z.string().date().default(() => new Date().toISOString().split('T')[0]!),
  due_date: z.string().date().optional().nullable(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded', 'partially_paid', 'void']).optional().default('draft'),
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
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired', 'negotiating', 'won', 'lost']).optional().default('draft'),
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
  company_id: uuid,
  service_id: uuid,
  status: z.enum(['trial', 'active', 'paused', 'cancelled', 'expired', 'past_due', 'incomplete']).optional().default('trial'),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  trial_end_date: z.string().date().optional().nullable(),
  billing_frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional().default('monthly'),
  auto_renew: z.boolean().optional().default(true),
  quantity: z.coerce.number().int().min(1).optional().default(1),
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
  title: requiredString.max(200),
  contact_id: uuid,
  company_id: uuid,
  type: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['draft', 'active', 'expired', 'terminated', 'renewed', 'signed', 'pending_approval']).optional().default('draft'),
  start_date: z.string().date().default(() => new Date().toISOString().split('T')[0]!),
  end_date: z.string().date().optional().nullable(),
  value: z.coerce.number().min(0).optional().default(0),
  description: z.string().trim().max(5000).nullable().optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
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

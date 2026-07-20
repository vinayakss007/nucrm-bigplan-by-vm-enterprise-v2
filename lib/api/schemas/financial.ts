import { z } from 'zod';

const uuid = z.string().uuid().optional().nullable();
const requiredString = z.string().trim().min(1);

// ── Invoice schemas ──
export const createInvoiceSchema = z.object({
  contactId: uuid,
  companyId: uuid,
  dealId: uuid,
  number: z.string().max(50).optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
  currency: z.string().length(3).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  lineItems: z.array(z.object({
    description: requiredString.max(500),
    quantity: z.number().int().min(1).default(1),
    unitPrice: z.number().min(0),
    amount: z.number().min(0).optional(),
  })).optional(),
  subtotal: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  total: z.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

export const invoiceQuerySchema = z.object({
  status: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  min_total: z.coerce.number().optional(),
  max_total: z.coerce.number().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Quote schemas ──
export const createQuoteSchema = z.object({
  contactId: uuid,
  companyId: uuid,
  dealId: uuid,
  number: z.string().max(50).optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
  currency: z.string().length(3).optional(),
  validUntil: z.string().datetime().optional().nullable(),
  lineItems: z.array(z.object({
    description: requiredString.max(500),
    quantity: z.number().int().min(1).default(1),
    unitPrice: z.number().min(0),
    amount: z.number().min(0).optional(),
  })).optional(),
  subtotal: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  total: z.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateQuoteSchema = createQuoteSchema.partial();

// ── Order schemas ──
export const createOrderSchema = z.object({
  contactId: uuid,
  companyId: uuid,
  dealId: uuid,
  invoiceId: uuid,
  number: z.string().max(50).optional(),
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).optional(),
  currency: z.string().length(3).optional(),
  lineItems: z.array(z.object({
    description: requiredString.max(500),
    quantity: z.number().int().min(1).default(1),
    unitPrice: z.number().min(0),
    amount: z.number().min(0).optional(),
  })).optional(),
  subtotal: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  total: z.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateOrderSchema = createOrderSchema.partial();

// ── Contract schemas ──
export const createContractSchema = z.object({
  contactId: uuid,
  companyId: uuid,
  dealId: uuid,
  title: requiredString.max(200),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).optional(),
  type: z.string().max(100).optional(),
  value: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  autoRenew: z.boolean().optional(),
  terms: z.string().max(10000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateContractSchema = createContractSchema.partial();

// ── Subscription schemas ──
export const createSubscriptionSchema = z.object({
  contactId: uuid,
  companyId: uuid,
  planId: uuid,
  status: z.enum(['active', 'trialing', 'past_due', 'cancelled', 'expired']).optional(),
  quantity: z.number().int().min(1).default(1),
  trialEnd: z.string().datetime().optional().nullable(),
  currentPeriodEnd: z.string().datetime().optional().nullable(),
  cancelAtPeriodEnd: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateSubscriptionSchema = createSubscriptionSchema.partial();

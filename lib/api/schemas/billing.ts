/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { uuid, requiredString } from './common';

/**
 * #2258 — the ONE invoice-status vocabulary the app accepts, kept byte-for-byte
 * in sync with the DB CHECK `chk_invoices_status` (widened by migration
 * 0112_invoice_status_vocab and registered in scripts/constraint-vocab.json).
 *
 * Before this, Zod allowed `void`/`refunded` that the DB rejected (schema-valid
 * payload → 23514), while DB-legal `written_off`/`pending` were unaddressable
 * through the API. Per-value decisions:
 *   void         — REAL product state: lib/billing/payments.ts and the PayU
 *                  webhook both refuse payments against a `void` invoice, a
 *                  guard that could never fire while the CHECK rejected it.
 *                  The DB was widened to accept it; Zod keeps it.
 *   refunded     — NOT a product state for invoices: refunds live in the
 *                  invoice_payments ledger and recalculateInvoicePayments()
 *                  deliberately preserves the invoice status across a refund
 *                  (lib/billing/payments.ts:58-59). It had no writer and no
 *                  reader anywhere and reads like a copy-paste from
 *                  createOrderSchema. REMOVED from Zod so the API answers a
 *                  clear 400 instead of writing a status nothing understands.
 *   written_off  — DB-legal (bad-debt write-offs, legacy rows may carry it);
 *                  added to Zod so those rows stay PATCH-able.
 *   pending      — DB-legal; same reasoning as `written_off`.
 *
 * `paid`/`partially_paid` remain in the vocabulary (the ledger writes them) but
 * the PUT route still rejects hand-setting them — that is ownership, not
 * vocabulary (#2226).
 *
 * Any change here MUST be mirrored in
 * drizzle/migrations/0112_invoice_status_vocab.sql (or its successor) and
 * scripts/constraint-vocab.json, or tests/unit/schema/
 * invoice-status-vocab-migration.test.ts fails.
 */
export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'partially_paid',
  'written_off',
  'pending',
  'void',
] as const;

// ── Invoice schemas ──
export const createInvoiceSchema = z.object({
  contact_id: uuid,
  company_id: uuid,
  issue_date: z.string().date().default(() => new Date().toISOString().split('T')[0]!),
  due_date: z.string().date().optional().nullable(),
  status: z.enum(INVOICE_STATUSES).optional().default('draft'),
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
  contact_id: uuidIdSchema.optional(),
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
  contact_id: uuidIdSchema.optional(),
  deal_id: uuidIdSchema.optional(),
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
  contact_id: uuidIdSchema.optional(),
  deal_id: uuidIdSchema.optional(),
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
  contact_id: uuidIdSchema.optional(),
  q: z.string().optional(),
});

// ── Contract schemas ──
/**
 * Mirrors `chk_contracts_contract_type` exactly. The column is NOT NULL and the
 * check has no NULL escape, so a value outside this list cannot be stored — the
 * route used to default to `'other'`, which the database then refused, and the
 * create form offered `sales` and `other` as choices. Exported so the picker in
 * app/tenant/contracts is rendered from the same list instead of drifting again.
 */
export const CONTRACT_TYPES = [
  'service', 'nda', 'sla', 'partnership', 'employment', 'vendor', 'non_compete',
  'licensing', 'consulting', 'master_service', 'statement_of_work', 'amendment',
  'end_user_license',
] as const;

/** Display names for the picker, keyed off CONTRACT_TYPES so it cannot drift. */
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  service: 'Service', nda: 'NDA', sla: 'SLA', partnership: 'Partnership',
  employment: 'Employment', vendor: 'Vendor', non_compete: 'Non-compete',
  licensing: 'Licensing', consulting: 'Consulting', master_service: 'Master service',
  statement_of_work: 'Statement of work', amendment: 'Amendment',
  end_user_license: 'End-user licence',
};

export type ContractType = typeof CONTRACT_TYPES[number];

export const createContractSchema = z.object({
  title: requiredString.max(200),
  contact_id: uuid,
  company_id: uuid,
  type: z.enum(CONTRACT_TYPES).nullable().optional(),
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
  contact_id: uuidIdSchema.optional(),
  deal_id: uuidIdSchema.optional(),
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

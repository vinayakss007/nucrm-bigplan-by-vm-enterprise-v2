/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { uuid, requiredString } from './common';

// ── Ticket schemas ──
/**
 * `support_tickets.body` is NOT NULL, but `description` used to be optional, so a
 * body-less POST sailed through validation and the INSERT threw — a 500 whose dev
 * message carried the whole SQL statement plus its bound values (Issue #2285).
 *
 * Clients also naturally send `body`, the name the column and the Helpdesk create
 * modal use; it was silently dropped, so even a caller that supplied body text got
 * the 500. Both names are accepted, and at least one must carry text.
 */
const ticketBodyField = z.string().trim().max(10000);
const ticketFieldsSchema = z.object({
  subject: requiredString.max(300, 'Subject too long'),
  description: ticketBodyField.nullable().optional(),
  body: ticketBodyField.nullable().optional(),
  status: z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed', 'awaiting_customer', 'on_hold', 'escalated']).optional().default('open'),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'critical']).optional().default('medium'),
  category: z.string().trim().max(100).nullable().optional(),
  contact_id: uuid,
  assigned_to: uuid,
  tags: z.array(z.string()).optional().default([]),
});

/**
 * The text that actually lands in `support_tickets.body`: whichever name the
 * caller used, preferring a non-empty `description`. Empty for a value that never
 * passed `createTicketSchema` — the schema is what guarantees a real string.
 */
export function ticketBodyText(v: { description?: string | null; body?: string | null }): string {
  const description = (v.description ?? '').trim();
  return description || (v.body ?? '').trim();
}

export const createTicketSchema = ticketFieldsSchema.superRefine((v, ctx) => {
  if (!ticketBodyText(v)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['description'],
      message: 'description (or body) is required',
    });
  }
});

// `.partial()` refuses a refined object, so the PATCH contract is derived from
// the unrefined fields — a status/priority-only edit stays valid.
export const updateTicketSchema = ticketFieldsSchema.partial();

export const ticketQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
});

// ── Ticket Reply schemas ──
export const createTicketReplySchema = z.object({
  message: requiredString.max(10000, 'Reply too long'),
  is_internal: z.boolean().optional().default(false),
  attachments: z.array(z.object({
    name: requiredString,
    url: requiredString,
    type: requiredString,
    size: z.number().int().min(0),
  })).optional().default([]),
  contact_id: uuid,
});

export const ticketReplyQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  contact_id: uuidIdSchema.optional(),
});

// ── KB Article schemas ──
export const createKbArticleSchema = z.object({
  title: requiredString.max(300),
  content: requiredString.max(50000),
  category_id: uuidIdSchema.optional(),
  status: z.enum(['draft', 'published', 'archived', 'review', 'needs_review']).optional().default('draft'),
  tags: z.array(z.string()).optional().default([]),
  order: z.coerce.number().int().min(0).optional().default(0),
  meta_description: z.string().max(300).optional().nullable(),
});

export const updateKbArticleSchema = createKbArticleSchema.partial();

export const kbArticleQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  category_id: uuidIdSchema.optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// ── KB Category schemas ──
export const createKbCategorySchema = z.object({
  name: requiredString.max(100),
  description: z.string().trim().max(500).nullable().optional(),
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid slug').max(100).transform(v => v.toLowerCase()),
  parent_id: uuid,
  order: z.coerce.number().int().min(0).optional().default(0),
  is_public: z.boolean().optional().default(true),
});

export const updateKbCategorySchema = createKbCategorySchema.partial();

// ── Type exports ──
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateTicketReplyInput = z.infer<typeof createTicketReplySchema>;
export type CreateKbArticleInput = z.infer<typeof createKbArticleSchema>;
export type UpdateKbArticleInput = z.infer<typeof updateKbArticleSchema>;
export type CreateKbCategoryInput = z.infer<typeof createKbCategorySchema>;
export type UpdateKbCategoryInput = z.infer<typeof updateKbCategorySchema>;

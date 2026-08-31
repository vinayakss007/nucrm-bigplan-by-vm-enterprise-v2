/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuid, requiredString } from './common';

// ── Ticket schemas ──
export const createTicketSchema = z.object({
  subject: requiredString.max(300, 'Subject too long'),
  description: z.string().trim().max(10000).nullable().optional(),
  status: z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed', 'awaiting_customer', 'on_hold', 'escalated']).optional().default('open'),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'critical']).optional().default('medium'),
  category: z.string().trim().max(100).nullable().optional(),
  contact_id: uuid,
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
  contact_id: z.string().uuid().optional(),
});

// ── KB Article schemas ──
export const createKbArticleSchema = z.object({
  title: requiredString.max(300),
  content: requiredString.max(50000),
  category_id: z.string().uuid().optional(),
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
  category_id: z.string().uuid().optional(),
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

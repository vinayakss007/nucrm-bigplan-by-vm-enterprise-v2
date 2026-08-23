/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuid, requiredString } from './common';

// ── Ticket schemas ──
export const createTicketSchema = z.object({
  subject: requiredString.max(200, 'Subject too long'),
  description: requiredString.max(5000, 'Description too long'),
  status: z.enum(['open', 'in_progress', 'waiting', 'closed', 'pending_customer', 'escalated', 'resolved', 'on_hold']).optional().default('open'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  category: z.string().trim().max(100).nullable().optional(),
  contact_id: uuid,
  company_id: uuid,
  assigned_to: uuid,
  tags: z.array(z.string()).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  attachments: z.array(z.object({
    name: requiredString,
    url: requiredString,
    type: requiredString,
    size: z.number().int().min(0),
  })).optional().default([]),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional().nullable(),
  channel: z.enum(['email', 'chat', 'phone', 'web', 'social', 'portal', 'api']).optional().nullable(),
});

export const updateTicketSchema = createTicketSchema.partial();

export const ticketQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigned_to: z.string().uuid().optional().or(z.literal('')),
  contact_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
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
  title: requiredString.max(200, 'Title too long'),
  content: requiredString.max(50000, 'Content too long'),
  category_id: uuid,
  status: z.enum(['draft', 'published', 'archived', 'review', 'pending_review', 'needs_update']).optional().default('draft'),
  visibility: z.enum(['public', 'internal', 'private', 'portal', 'private_portal']).optional().default('public'),
  tags: z.array(z.string()).optional().default([]),
  author: requiredString.max(200),
  slug: z.string().trim().max(200).nullable().optional(),
  seo_title: z.string().trim().max(100).nullable().optional(),
  seo_description: z.string().trim().max(300).nullable().optional(),
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
  name: requiredString.max(100, 'Category name too long'),
  slug: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  parent_id: uuid,
  order: z.coerce.number().int().min(0).optional().default(0),
  visibility: z.enum(['public', 'internal', 'portal', 'private', 'private_portal']).optional().default('public'),
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

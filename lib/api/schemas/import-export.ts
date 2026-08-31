/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { requiredString } from './common';

// ── Import schemas ──
export const importSchema = z.object({
  entity_type: z.enum(['contacts', 'companies', 'deals', 'leads']),
  data: z.array(z.record(z.string(), z.unknown())).min(1, 'At least one record required').max(10000),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  skip_duplicates: z.boolean().optional().default(true),
});

export const importContactsSchema = z.object({
  file_url: z.string().url('Invalid file URL'),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  skip_duplicates: z.boolean().optional().default(true),
  dry_run: z.boolean().optional().default(false),
});

// ── Merge Contact schema ──
export const mergeContactSchema = z.object({
  primary_contact_id: z.string().uuid(),
  duplicate_contact_id: z.string().uuid(),
  merge_strategy: z.record(z.string(), z.unknown()).optional().default({}),
  reason: z.string().trim().max(500).optional().nullable(),
});

// ── Lead Convert schema ──
export const convertLeadSchema = z.object({
  create_deal: z.boolean().optional().default(false),
  deal_title: z.string().trim().max(200).optional().nullable(),
  deal_value: z.coerce.number().min(0).optional().default(0),
  deal_stage: z.string().uuid().optional().nullable(),
  pipeline_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

// ── Search schema ──
export const searchSchema = z.object({
  q: requiredString.max(200),
  entity_types: z.array(z.enum(['contacts', 'companies', 'deals', 'leads', 'tasks', 'tickets'])).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Bulk operations schemas ──
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
  updates: z.record(z.string(), z.unknown()),
});

// ── Export schema ──
export const exportSchema = z.object({
  entity_type: z.enum(['contacts', 'companies', 'deals', 'leads', 'tasks', 'tickets', 'invoices']),
  format: z.enum(['csv', 'json']).optional().default('csv'),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  fields: z.array(z.string()).optional(),
});

// ── Type exports ──
export type ImportInput = z.infer<typeof importSchema>;
export type ImportContactsInput = z.infer<typeof importContactsSchema>;
export type MergeContactInput = z.infer<typeof mergeContactSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type ExportInput = z.infer<typeof exportSchema>;

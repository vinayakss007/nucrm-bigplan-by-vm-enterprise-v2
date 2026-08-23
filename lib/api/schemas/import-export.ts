/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

// ── Import schemas ──
export const importSchema = z.object({
  file_url: z.string().url('Invalid file URL'),
  entity_type: z.enum(['contacts', 'deals', 'companies']).default('contacts'),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  skip_duplicates: z.boolean().optional().default(true),
  dry_run: z.boolean().optional().default(false),
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
  q: z.string().trim().min(1).max(500),
  entity_type: z.enum(['contacts', 'deals', 'companies', 'tickets']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ── Bulk operations schemas ──
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
  entity_type: z.string().max(50).optional(),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(1000),
  updates: z.record(z.string(), z.unknown()).refine(obj => Object.keys(obj).length > 0, 'At least one update field required'),
  entity_type: z.string().max(50).optional(),
});

// ── Export schema ──
export const exportSchema = z.object({
  entity_type: z.enum(['contacts', 'deals', 'companies', 'tickets', 'invoices', 'quotes']),
  format: z.enum(['csv', 'xlsx', 'json']).optional().default('csv'),
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

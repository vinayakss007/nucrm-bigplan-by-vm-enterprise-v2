/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { requiredString } from './common';

// ── Plan schemas ──
export const createPlanSchema = z.object({
  id: z.string().max(50).optional(),
  name: requiredString.max(200),
  slug: z.string().max(100).optional(),
  price_monthly: z.coerce.number().min(0).optional().default(0),
  price_yearly: z.coerce.number().min(0).optional().default(0),
  max_users: z.coerce.number().int().min(1).optional().default(5),
  max_contacts: z.coerce.number().int().min(0).optional().default(1000),
  max_deals: z.coerce.number().int().min(0).optional().default(500),
  max_storage_gb: z.coerce.number().min(0).optional().default(1),
  max_automations: z.coerce.number().int().min(0).optional().default(5),
  max_forms: z.coerce.number().int().min(0).optional().default(3),
  max_api_calls_day: z.coerce.number().int().min(0).optional().default(1000),
  features: z.array(z.string()).optional().default([]),
  sort_order: z.coerce.number().int().min(0).optional().default(99),
  description: z.string().trim().max(500).optional().nullable(),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  id: z.string().max(50),
});

// ── Announcement schemas ──
export const createAnnouncementSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  body: z.string().max(10000).optional(),
  content: z.string().max(10000).optional(),
  type: z.enum(['info', 'warning', 'success', 'error', 'maintenance']).optional().default('info'),
  target: z.enum(['all', 'plans', 'tenants', 'users']).optional().default('all'),
  is_active: z.boolean().optional().default(true),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
});

export const updateAnnouncementSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  body: z.string().max(10000).optional(),
  content: z.string().max(10000).optional(),
  type: z.enum(['info', 'warning', 'success', 'error', 'maintenance']).optional(),
  target: z.enum(['all', 'plans', 'tenants', 'users']).optional(),
  is_active: z.boolean().optional(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  updated_at: z.string().datetime().optional(),
});

export const deleteAnnouncementSchema = z.object({
  id: z.string().uuid(),
});

// ── System Key schema ──
export const setSystemKeySchema = z.object({
  tenantId: z.string().uuid(),
  provider: requiredString.max(50),
  api_key: z.string().min(1, 'API key is required'),
  base_url: z.string().url().optional().nullable(),
  model: z.string().trim().max(100).optional().nullable(),
});

// ── Rate Limits schema ──
export const updateRateLimitsSchema = z.object({
  action: z.enum(['update_global', 'update_plan_limits', 'toggle_super_admin_unlimited', 'reset_to_defaults']),
  rateLimits: z.record(z.string(), z.unknown()).optional(),
  planId: z.string().uuid().optional(),
  unlimited: z.boolean().optional(),
  userId: z.string().uuid().optional(),
});

// ── Superadmin Invite Member schema ──
export const superadminInviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().trim().max(200).optional(),
  role_slug: z.string().trim().max(50).optional().default('user'),
});
// NOTE: no `inviteMemberSchema` alias here. The name `inviteMemberSchema` is
// owned by the canonical monolith (lib/api/schemas.ts) — both live importers
// (superadmin + tenant members routes) use that one. The former alias had no
// importers and only collided with the canonical name (#1883). Import
// `superadminInviteMemberSchema` explicitly if the superadmin variant is needed.

// ── Tenant schemas ──
export const createTenantSchema = z.object({
  name: requiredString.max(200),
  plan_id: z.string().max(50).optional().default('free'),
  status: z.enum(['active', 'trialing', 'suspended', 'cancelled']).optional().default('active'),
  billing_email: z.string().email().optional().nullable(),
  primary_color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().default('#7c3aed'),
  owner_email: z.string().email().optional().nullable(),
  owner_name: z.string().trim().max(200).optional().nullable(),
  owner_password: z.string().min(8).optional().nullable(),
  trial_days: z.coerce.number().int().min(0).max(365).optional().default(14),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'trialing', 'suspended', 'cancelled']).optional(),
  billing_email: z.string().email().optional().nullable(),
  primary_color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
  plan_id: z.string().max(50).optional(),
  admin_notes: z.string().max(2000).optional().nullable(),
  manual_paid_until: z.string().date().optional().nullable(),
  logo_url: z.string().max(500).optional().nullable(),
  custom_domain: z.string().max(255).optional().nullable(),
  trial_ends_at: z.string().date().optional().nullable(),
  billing_type: z.string().max(50).optional(),
});

export const platformSettingsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

// ── Backup schemas ──
export const createBackupSchema = z.object({
  backup_type: z.enum(['full', 'schema', 'selective']).optional().default('full'),
  action: z.literal('restore').optional(),
  backupId: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
});

export const backupConfigSchema = z.object({
  endpoint_url: z.string().max(500).optional().default(''),
  bucket: requiredString.max(200),
  access_key: requiredString.max(200),
  secret_key: z.string().max(500).optional(),
  region: z.string().max(100).optional().default('us-east-1'),
  backup_type: z.enum(['full', 'schema']).optional().default('full'),
  enabled: z.boolean().optional().default(true),
  schedule: z.string().max(100).optional().default('0 2 * * *'),
  retention_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  point_in_time_recovery: z.boolean().optional().default(false),
});

// ── Type exports ──
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type CreateBackupInput = z.infer<typeof createBackupSchema>;
export type BackupConfigInput = z.infer<typeof backupConfigSchema>;

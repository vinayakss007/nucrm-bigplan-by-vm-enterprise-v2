/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

// ── Auth schemas ──
export const signupSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(255),
  workspace_name: z.string().trim().min(1).max(255),
});

export const loginSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
  totp_token: z.string().optional(),
  remember_me: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

// ── 2FA schemas ──
export const setup2faSchema = z.object({
  password: z.string().min(8),
});

/**
 * POST /api/tenant/2fa/verify
 *
 * The field is `totp_code` — that is what the client sends and what the route
 * destructures. The caller is already authenticated by requireAuth, so no
 * password is required here.
 */
export const verify2faSchema = z.object({
  totp_code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit code'),
});

/**
 * POST /api/tenant/2fa/disable
 *
 * Password is mandatory (the route re-verifies it before disabling 2FA).
 * `totp_code` is optional because 2FA may be half-enrolled.
 */
export const disable2faSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  totp_code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit code').optional(),
});

// ── Password change schema ──
export const changePasswordSchema = z.object({
  current_password: z.string().trim().min(1),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── SSO ──
export const createSsoProviderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum(['oidc', 'saml']).default('oidc'),
  issuer: z.string().url('Issuer must be a fully-qualified URL').startsWith('https', 'Issuer must use HTTPS'),
  client_id: z.string().min(1, 'Client ID is required'),
  client_secret: z.string().min(1, 'Client secret is required'),
  discovery_url: z.string().url().optional(),
  scopes: z.string().optional().default('openid profile email'),
  enabled: z.boolean().optional().default(true),
});

export const updateSsoProviderSchema = createSsoProviderSchema.partial();

// ── Webhooks ──
export const testWebhookSchema = z.object({
  event: z.string().min(1, 'Event type is required'),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

// ── Admin ──
export const loginPolicySchema = z.object({
  max_login_attempts: z.number().int().min(1).max(100).optional(),
  lockout_duration_minutes: z.number().int().min(1).max(10080).optional(),
  session_timeout_minutes: z.number().int().min(5).max(43200).optional(),
  require_2fa: z.boolean().optional(),
  allowed_domains: z.array(z.string().trim().min(1)).optional(),
  ip_allowlist: z.array(z.string().trim()).optional(),
});

export const localizationSchema = z.object({
  timezone: z.string().max(50).optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  week_start_day: z.number().int().min(0).max(6).optional(),
  date_format: z.string().max(30).optional(),
  time_format: z.enum(['12h', '24h']).optional(),
  currency: z.string().max(10).optional(),
});

// ── Type exports ──
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

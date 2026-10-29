/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { requiredString } from './common';
import { validatePassword } from '@/lib/auth/session';

// ── Auth schemas ──
/**
 * #3277: the server's password policy lives in `validatePassword`
 * (lib/auth/session.ts — min 12, upper, digit, special), but four NEW-password
 * schemas hand-declared their own minimums, the weakest saying `min(8)`. A
 * scripted client trusted the advertised contract and got refused mid-flow by
 * the policy layer with a different message. This schema defers to
 * `validatePassword` itself, so the contract and the enforcement cannot drift
 * apart again. It belongs to NEW-password fields only; the #1286 note below
 * keeps existing-password re-entry fields deliberately lenient on purpose.
 */
export const passwordSchema = z.string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    const error = validatePassword(value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  })
  .max(128);

export const signupSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: passwordSchema,
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
  password: passwordSchema,
});

// ── 2FA schemas ──
// #1286: the `password` field in each of these schemas is the user's EXISTING
// password re-entered to authorize a sensitive 2FA action (setup/verify/disable).
// It is checked against the stored password hash (see app/api/tenant/2fa/*),
// NOT against the new-password policy in validatePassword() (min 12 chars).
// It is therefore deliberately left lenient — raising it to min(12) would lock
// out users whose valid existing password predates the 12-char rule. Only
// NEW-password fields (e.g. changePasswordSchema.new_password) use min(12).
export const setup2faSchema = z.object({
  password: requiredString.min(8),
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
// new_password's min length must match validatePassword() in
// lib/auth/session.ts (12 chars), or the schema accepts passwords the
// validator then rejects (#1286).
export const changePasswordSchema = z.object({
  current_password: requiredString.min(1),
  new_password: requiredString.min(12, 'Password must be at least 12 characters'),
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

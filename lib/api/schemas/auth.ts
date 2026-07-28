import { z } from 'zod';

// ── 2FA ──────────────────────────────────────────────────────────────────────

export const verify2faSchema = z.object({
  totp_code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit code'),
});

export const disable2faSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  totp_code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit code').optional(),
});

// ── SSO ──────────────────────────────────────────────────────────────────────

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

// ── Webhooks ─────────────────────────────────────────────────────────────────

export const testWebhookSchema = z.object({
  event: z.string().min(1, 'Event type is required'),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

// ── Admin ────────────────────────────────────────────────────────────────────

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

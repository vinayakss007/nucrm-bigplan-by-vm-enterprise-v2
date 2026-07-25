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

export const verify2faSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Invalid TOTP token'),
  password: z.string().min(8),
});

export const disable2faSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Invalid TOTP token'),
  password: z.string().min(8),
});

// ── Password change schema ──
export const changePasswordSchema = z.object({
  current_password: z.string().trim().min(1),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── Type exports ──
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

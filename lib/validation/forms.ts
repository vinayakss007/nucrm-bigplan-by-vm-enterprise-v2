/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────────

/** Optional string that is allowed to be empty (''), used for optional fields. */
const optionalMax = (max: number) => z.string().trim().max(max).optional();

/** Optional URL: allowed to be empty, but must be a valid URL when non-empty. */
const optionalUrl = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === '' || z.string().url().safeParse(v).success, {
      message: 'Must be a valid URL',
    })
    .optional();

const hexColor = z
  .string()
  .regex(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    'Must be a hex color like #7c3aed'
  );

// Phone: optional, allows leading + and digits/spaces/dashes/parens, max 30 chars.
const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === '' || /^\+?[\d\s()-]+$/.test(v), {
    message: 'Invalid phone number',
  })
  .optional();

// ──────────────────────────────────────────────────────────────────────────
// (a) Simple lead form — components/shared/simple-lead-form.tsx
// ──────────────────────────────────────────────────────────────────────────
export const simpleLeadFormSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  last_name: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().min(1, 'Email is required').email('Invalid email'),
  phone: optionalPhone,
  company: optionalMax(200),
  message: optionalMax(5000),
});
export type SimpleLeadFormInput = z.infer<typeof simpleLeadFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (b) Lead capture form — components/shared/lead-capture-form.tsx
// ──────────────────────────────────────────────────────────────────────────
export const leadCaptureFormSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  last_name: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().min(1, 'Email is required').email('Invalid email'),
  phone: optionalPhone,
  company: optionalMax(200),
});
export type LeadCaptureFormInput = z.infer<typeof leadCaptureFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (c) SMS compose form — app/tenant/sms/page.tsx
// Preserve the existing #1342 normalization: strip spaces/parens/dashes then
// require +?digits{7,15}. Body OR templateId must be present.
// ──────────────────────────────────────────────────────────────────────────
export const smsComposeSchema = z
  .object({
    to: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s()-]/g, ''))
      .refine((v) => /^\+?\d{7,15}$/.test(v), {
        message: 'Enter a valid phone number',
      }),
    body: z.string().max(1600).optional(),
    templateId: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    const hasBody = !!val.body && val.body.trim().length > 0;
    const hasTemplate = !!val.templateId && val.templateId.trim().length > 0;
    if (!hasBody && !hasTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a message or select a template',
        path: ['body'],
      });
    }
  });
export type SmsComposeInput = z.infer<typeof smsComposeSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (d) Meeting form — app/tenant/calendar/page.tsx
// ──────────────────────────────────────────────────────────────────────────
export const meetingFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    start_time: z.string().min(1, 'Start time is required'),
    end_time: z.string().optional(),
    contact_id: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.end_time && val.end_time.length > 0) {
      const start = new Date(val.start_time).getTime();
      const end = new Date(val.end_time).getTime();
      if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End time must be after start time',
          path: ['end_time'],
        });
      }
    }
  });
export type MeetingFormInput = z.infer<typeof meetingFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (e) Webhook form — app/tenant/settings/webhooks/page.tsx
// ──────────────────────────────────────────────────────────────────────────
export const webhookFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  url: z.string().trim().min(1, 'URL is required').url('Must be a valid URL'),
  events: z.array(z.string()).min(1, 'Select at least one event'),
});
export type WebhookFormInput = z.infer<typeof webhookFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (f) Branding form — app/tenant/settings/branding/page.tsx
// ──────────────────────────────────────────────────────────────────────────
export const brandingFormSchema = z.object({
  logoUrl: optionalUrl(1000),
  faviconUrl: optionalUrl(1000),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  accentColor: hexColor,
  companyName: optionalMax(200),
  customDomain: z
    .string()
    .trim()
    .max(253)
    .refine(
      (v) =>
        v === '' ||
        /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/.test(v),
      { message: 'Enter a valid hostname without protocol or path' }
    )
    .optional(),
  customCss: optionalMax(10000),
  headerLayout: z.enum(['default', 'centered', 'minimal']),
});
export type BrandingFormInput = z.infer<typeof brandingFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (g) Backup config form — app/tenant/settings/backup/page.tsx
// ──────────────────────────────────────────────────────────────────────────
export const backupConfigSchema = z.object({
  bucket: z.string().trim().min(1, 'Bucket is required').max(200),
  endpoint_url: optionalUrl(500),
  access_key: optionalMax(200),
  secret_key: optionalMax(500),
  region: optionalMax(100),
  retention_days: z.coerce
    .number()
    .int('Retention days must be a whole number')
    .min(1, 'Retention days must be at least 1')
    .max(365, 'Retention days must be at most 365'),
});
export type BackupConfigInput = z.infer<typeof backupConfigSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (h) Superadmin create user — app/superadmin/users/page.tsx
// Password must match the UI minLength=12 and be reasonably strong.
// ──────────────────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Invalid email'),
  full_name: optionalMax(200),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/\d/, 'Password must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// ──────────────────────────────────────────────────────────────────────────
// (i) Dynamic public form — app/forms/public/[id]/public-form-client.tsx
// Builds a schema requiring each field marked required to be a non-empty
// string, keyed by field.key.
// ──────────────────────────────────────────────────────────────────────────
export interface PublicFormFieldDef {
  key: string;
  label?: string;
  required?: boolean;
}

export function buildPublicFormSchema(
  fields: PublicFormFieldDef[]
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.required) {
      const label = field.label || field.key;
      shape[field.key] = z
        .string({ message: `${label} is required` })
        .trim()
        .min(1, `${label} is required`);
    } else {
      shape[field.key] = z.string().optional();
    }
  }
  return z.object(shape).passthrough() as z.ZodType<Record<string, unknown>>;
}

// ──────────────────────────────────────────────────────────────────────────
// Generic validation helper
// ──────────────────────────────────────────────────────────────────────────

export type ValidateResult<T> =
  | { success: true; data: T }
  | { success: false; errors: Record<string, string> };

/**
 * Runs schema.safeParse and, on failure, flattens the errors into a flat
 * Record<string, string> keyed by field name with the first message per field.
 * Cross-field / top-level refinement messages are surfaced under a '_form' key.
 */
export function validateForm<T>(
  schema: z.ZodType<T>,
  values: unknown
): ValidateResult<T> {
  const result = schema.safeParse(values);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const flat = result.error.flatten() as {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
  const errors: Record<string, string> = {};

  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    const first = messages?.[0];
    if (first !== undefined) {
      errors[key] = first;
    }
  }

  const formError = flat.formErrors[0];
  if (formError !== undefined) {
    errors._form = formError;
  }

  return { success: false, errors };
}

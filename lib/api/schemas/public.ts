import { z } from 'zod';

// ── Public Lead Capture schema ──
export const publicLeadCaptureSchema = z.object({
  first_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().max(100).optional().nullable(),
  email: z.string().email('Invalid email'),
  phone: z.string().max(30).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(5000).optional().nullable(),
  source: z.string().trim().max(100).optional().default('Website Form'),
  tenant_id: z.string().uuid(),
  form_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

// ── Public Form Submit schema ──
export const publicFormSubmitSchema = z.object({
  form_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional().default({}),
  values: z.record(z.string(), z.unknown()).optional().default({}),
});

// ── Checkout Session schema ──
export const checkoutSessionSchema = z.object({
  plan_id: z.string().uuid(),
});

// ── Type exports ──
export type PublicLeadCaptureInput = z.infer<typeof publicLeadCaptureSchema>;
export type PublicFormSubmitInput = z.infer<typeof publicFormSubmitSchema>;
export type CheckoutSessionInput = z.infer<typeof checkoutSessionSchema>;

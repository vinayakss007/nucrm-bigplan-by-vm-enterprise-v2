import { z } from 'zod';
import { requiredString } from './common';

// ── Automation schemas ──
export const createAutomationSchema = z.object({
  name: requiredString.max(200, 'Name too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  trigger_type: requiredString.max(100),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  actions: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  conditions: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export const updateAutomationSchema = createAutomationSchema.partial().extend({
  conditions: z.array(z.record(z.string(), z.unknown())).optional(),
});

// ── Workflow schemas ──
export const createWorkflowSchema = z.object({
  name: requiredString.max(200, 'Name too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  trigger_type: requiredString.max(100),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  steps: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  nodes: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();

// ── Sequence schemas ──
export const createSequenceSchema = z.object({
  name: requiredString.max(200, 'Name too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'draft', 'paused', 'completed']).optional().default('draft'),
  steps: z.array(z.object({
    type: z.enum(['email', 'delay', 'condition', 'task']),
    config: z.record(z.string(), z.unknown()).optional().default({}),
    delay_days: z.coerce.number().int().min(0).optional().default(0),
  })).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export const updateSequenceSchema = createSequenceSchema.partial();

// ── Email Template schemas ──
export const createEmailTemplateSchema = z.object({
  name: requiredString.max(200, 'Template name too long'),
  subject: requiredString,
  body: requiredString,
  html_body: z.string().max(100000).optional().nullable(),
  category: z.string().trim().max(50).optional(),
  tags: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  is_system: z.boolean().optional().default(false),
  language: z.string().trim().max(10).optional(),
  reply_to: z.string().email().optional().nullable(),
  cc: z.array(z.string().email()).optional().default([]),
  bcc: z.array(z.string().email()).optional().default([]),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();

// ── Form schemas ──
export const createFormSchema = z.object({
  name: requiredString.max(200, 'Form name too long'),
  slug: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  fields: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  submit_action: z.enum(['message', 'redirect', 'webhook']).optional().default('message'),
  submit_url: z.string().url().optional().nullable(),
  redirect_url: z.string().url().optional().nullable(),
  success_message: z.string().trim().max(500).optional().nullable(),
  notification_emails: z.array(z.string().email()).optional().default([]),
  is_active: z.boolean().optional().default(true),
  theme: z.string().trim().max(50).optional(),
});

export const updateFormSchema = createFormSchema.partial();

// ── Webhook schemas ──
export const createWebhookSchema = z.object({
  url: z.string().url('Invalid webhook URL'),
  events: z.array(z.string()).min(1, 'At least one event required'),
  name: z.string().trim().max(200).optional(),
  secret: z.string().trim().max(500).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  is_active: z.boolean().optional().default(true),
  description: z.string().trim().max(2000).optional(),
});

export const updateWebhookSchema = createWebhookSchema.partial();

// ── Trigger Workflow schema ──
export const triggerWorkflowSchema = z.object({
  trigger_entity_type: requiredString.max(100),
  trigger_entity_id: z.string().uuid(),
});

// ── WhatsApp Send schema ──
export const sendWhatsAppSchema = z.object({
  to: requiredString.max(20),
  message_type: z.enum(['template', 'text']).optional().default('text'),
  content: z.record(z.string(), z.unknown()).optional().default({}),
  template_name: z.string().trim().max(100).optional().nullable(),
  language: z.string().max(10).optional().default('en'),
  contact_id: z.string().uuid().optional().nullable(),
});

// ── Type exports ──
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type TriggerWorkflowInput = z.infer<typeof triggerWorkflowSchema>;
export type SendWhatsAppInput = z.infer<typeof sendWhatsAppSchema>;

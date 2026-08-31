/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { requiredString, uuid, urlField } from './common';

// ── Automation schemas ──
export const createAutomationSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  event: requiredString.max(100),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.unknown(),
  })).optional().default([]),
  actions: z.array(z.object({
    type: z.string(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  })).min(1, 'At least one action required'),
  is_active: z.boolean().optional().default(true),
});

export const updateAutomationSchema = createAutomationSchema.partial();

// ── Workflow schemas ──
export const createWorkflowSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  trigger_type: z.enum(['event', 'schedule', 'manual']).optional().default('event'),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  nodes: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  edges: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();

// ── Sequence schemas ──
export const createSequenceSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed']).optional().default('draft'),
  steps: z.array(z.object({
    type: z.enum(['email', 'task', 'wait']),
    delay_minutes: z.coerce.number().int().min(0).optional().default(0),
    template_id: uuid,
    subject: z.string().max(200).optional(),
    body: z.string().max(10000).optional(),
  })).optional().default([]),
});

export const updateSequenceSchema = createSequenceSchema.partial();

// ── Email Template schemas ──
export const createEmailTemplateSchema = z.object({
  name: requiredString.max(200),
  subject: requiredString.max(200),
  body: requiredString.max(50000),
  category: z.string().trim().max(100).nullable().optional(),
  variables: z.array(z.string()).optional().default([]),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();

// ── Form schemas ──
export const createFormSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  fields: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
  })).min(1, 'At least one field required').refine(
    (fields) => new Set(fields.map(f => f.id)).size === fields.length,
    { message: 'Duplicate field IDs are not allowed' }
  ),
  is_active: z.boolean().optional().default(true),
  redirect_url: urlField,
  success_message: z.string().trim().max(500).nullable().optional(),
});

export const updateFormSchema = createFormSchema.partial();

// ── Webhook schemas ──
export const createWebhookSchema = z.object({
  name: requiredString.max(200),
  url: z.string().max(500),
  events: z.array(z.string()).min(1, 'At least one event required'),
  secret: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(true),
  headers: z.record(z.string(), z.string()).optional().default({}),
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

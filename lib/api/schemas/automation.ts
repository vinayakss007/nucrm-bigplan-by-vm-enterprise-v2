/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { requiredString, uuid, urlField } from './common';

// ── Automation schemas ──
export const createAutomationSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  // #2891: this key was `event`, a name no client of this endpoint has ever used — the dialog's
  // form (`app/tenant/automation/page.tsx:82-87`), the SDK (`lib/integrations/sdk.ts:192-195`),
  // the column (`drizzle/schema/automation.ts:20`) and the engine that matches on it all call it
  // `trigger_type`. Requiring a key nobody sends made every New Automation a 400, while the routes
  // read the stored value off the raw body and a caller that did send `event` got a 201 whose
  // trigger fell through to the column default `'event'` — an active automation that can never fire.
  //
  // Deliberately a bounded string, not an enum: `automations.trigger_type` carries no CHECK, and
  // the three vocabularies in play (the dialog's 14 labels, the engine's 12-member `TriggerEvent`,
  // the 6 events actually emitted) disagree in both directions. Narrowing here would make a
  // currently-offered option newly unsaveable, which is the decision #2806 still waits on.
  trigger_type: requiredString.max(100),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
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

/**
 * #2891: `.partial()` makes a key optional, it does not undo a `.default()` — so
 * `createAutomationSchema.partial()` parsed `PATCH /api/tenant/automations/[id]` bodies into
 * objects *bigger* than the request: measured on `main`, `parse({ is_active: false })` →
 * `{ conditions: [], is_active: false }` and `parse({})` → `{ conditions: [], is_active: true }`.
 * The route wrote both back, so pausing an automation deleted its conditions and an empty PATCH
 * re-activated a paused one. #2627 fixed this shape for deals; the defaults go here too, so an
 * omitted key stays absent.
 */
export const updateAutomationSchema = createAutomationSchema
  .extend({
    trigger_config: createAutomationSchema.shape.trigger_config.removeDefault(),
    conditions: createAutomationSchema.shape.conditions.removeDefault(),
    is_active: createAutomationSchema.shape.is_active.removeDefault(),
  })
  .partial();

// ── Workflow schemas ──
export const createWorkflowSchema = z.object({
  name: requiredString.max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  // No default: the POST route answers 400 when this is missing, and a zod
  // `.default()` silently materialises 'event' before the route ever sees it,
  // so the guard was unreachable and every name-only request created an
  // event-triggered workflow the caller never asked for.
  // This is chk_workflows_trigger_type's set (0050_data_validation_checks.sql),
  // which the schema guards rather than defines; #2806. `lib/api/schemas.ts`
  // re-exports this copy, so there is one declaration to keep in step — and it
  // is registered in scripts/constraint-vocab.json.
  trigger_type: z.enum(['manual', 'schedule', 'event', 'webhook']).optional(),
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
    // Must match chk_sequence_steps_step_type, which allows 'delay' (not 'wait').
    type: z.enum(['email', 'task', 'delay']),
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
    // #3296: the embed widget puts this into `id="…"`/`for="…"` on a page that is not ours. Escaping
    // it there is necessary, and not sufficient on its own — legacy `key`-shaped rows were written
    // before any schema existed and still stream out of the public form endpoint verbatim, so an
    // id that cannot carry markup is checked at the boundary as well.
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/i, 'Field IDs must be 1-64 characters of letters, digits, "-" or "_"'),
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
  trigger_entity_id: uuidIdSchema,
});

// ── Test Workflow schema ──
/** #2806 — the builder's Test button posts to `/api/tenant/workflows/[id]/test`.
 *  Unlike `/run`, the entity is optional here: a test with no entity exercises
 *  the workflow's plumbing (nodes, actions, template context) against nothing,
 *  which is what the button had to offer before an entity picker exists. When
 *  an id IS sent it must be a uuid — the engine scopes it by tenant either way. */
export const testWorkflowSchema = z.object({
  trigger_entity_type: z.string().trim().max(100).optional(),
  trigger_entity_id: uuidIdSchema.optional(),
});

// ── WhatsApp Send schema ──
export const sendWhatsAppSchema = z.object({
  to: requiredString.max(20),
  message_type: z.enum(['template', 'text']).optional().default('text'),
  content: z.record(z.string(), z.unknown()).optional().default({}),
  template_name: z.string().trim().max(100).optional().nullable(),
  language: z.string().max(10).optional().default('en'),
  contact_id: uuidIdSchema.optional().nullable(),
});

// ── Type exports ──
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type TriggerWorkflowInput = z.infer<typeof triggerWorkflowSchema>;
export type SendWhatsAppInput = z.infer<typeof sendWhatsAppSchema>;

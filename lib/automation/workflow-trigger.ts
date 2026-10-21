/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2806 option (a) — the workflow trigger vocabulary, in one place.
 *
 * `workflows.trigger_type` holds the trigger KIND (`chk_workflows_trigger_type`
 * in `drizzle/migrations/0050_data_validation_checks.sql` admits exactly
 * `WORKFLOW_TRIGGER_TYPES` below). The event name — which entity fires and what
 * happens to it — lives in `trigger_config` as `{ entity, event }`. The builder
 * used to store the dotted event directly in `trigger_type`, a value the CHECK
 * rejects, so no workflow could be created from the UI at all.
 *
 * This module is client-safe (no zod, no server imports) so
 * `components/tenant/workflow-builder.tsx`, the API routes, and the drift test
 * all read the same lists. `lib/api/schemas/automation.ts` keeps its own zod
 * enum literals on purpose: `scripts/constraint-vocab.json` requires every
 * declaredIn file to contain the values literally, and
 * `tests/unit/workflow-trigger-vocab-2806.test.ts` compares this list against
 * the zod enum and the migration, so the copies cannot drift apart.
 */

export const WORKFLOW_TRIGGER_TYPES = ['manual', 'schedule', 'event', 'webhook'] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export function isWorkflowTriggerType(value: unknown): value is WorkflowTriggerType {
  return typeof value === 'string' && (WORKFLOW_TRIGGER_TYPES as readonly string[]).includes(value);
}

export interface WorkflowTriggerEvent {
  entity: string;
  event: string;
  label: string;
}

/** The events the builder offers when the kind is `event`. The dotted value the
 *  old single select posted is now `{ entity, event }` inside `trigger_config`. */
export const WORKFLOW_TRIGGER_EVENTS: readonly WorkflowTriggerEvent[] = [
  { entity: 'contact', event: 'created', label: 'Contact Created' },
  { entity: 'contact', event: 'updated', label: 'Contact Updated' },
  { entity: 'deal', event: 'created', label: 'Deal Created' },
  { entity: 'deal', event: 'stage_changed', label: 'Deal Stage Changed' },
  { entity: 'deal', event: 'won', label: 'Deal Won' },
  { entity: 'deal', event: 'lost', label: 'Deal Lost' },
  { entity: 'task', event: 'created', label: 'Task Created' },
  { entity: 'task', event: 'completed', label: 'Task Completed' },
  { entity: 'form', event: 'submitted', label: 'Form Submitted' },
];

export const DEFAULT_TRIGGER_EVENT = 'contact.created';

export const TRIGGER_KIND_LABELS: Record<WorkflowTriggerType, string> = {
  manual: 'Manual',
  schedule: 'Scheduled',
  event: 'On Event',
  webhook: 'Webhook',
};

/** `deal.stage_changed` → `Deal Stage Changed`; null when the pair is not offered. */
export function triggerEventLabel(dotted: string): string | null {
  const [entity, event] = dotted.split('.');
  return WORKFLOW_TRIGGER_EVENTS.find(e => e.entity === entity && e.event === event)?.label ?? null;
}

/** Read `{ entity, event }` back out of a stored `trigger_config`; null when absent. */
export function triggerEventFromConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const { entity, event } = config as Record<string, unknown>;
  if (typeof entity !== 'string' || typeof event !== 'string') return null;
  return `${entity}.${event}`;
}

/** What the canvas trigger node shows: the event label for kind `event`, the kind label otherwise. */
export function triggerDescription(kind: string, dottedEvent: string | null): string | undefined {
  if (kind === 'event') {
    return (dottedEvent && triggerEventLabel(dottedEvent)) ?? triggerEventLabel(DEFAULT_TRIGGER_EVENT) ?? undefined;
  }
  return isWorkflowTriggerType(kind) ? TRIGGER_KIND_LABELS[kind] : undefined;
}

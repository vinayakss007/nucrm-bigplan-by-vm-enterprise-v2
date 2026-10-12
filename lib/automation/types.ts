/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared types for the automation system.
 * Used by both workflows.ts (prebuilt) and engine.ts (custom).
 */

export interface WorkflowTrigger {
  type: string;
  resource?: string;
  schedule?: string;     // cron expression
  condition?: string;    // human-readable condition description
}

/**
 * Payload shape passed to prebuilt workflow `execute` handlers by the
 * automation engine / test harness. All fields are optional because each
 * trigger supplies only the subset relevant to its workflow; handlers guard
 * before dereferencing.
 */
export interface WorkflowEventData {
  tenant_id?: string;
  tenant?: { name?: string };
  contact?: { id?: string; email?: string; first_name?: string; assigned_to?: string | null };
  lead?: { id?: string };
  task?: { id?: string; title?: string; assigned_to?: string | null };
  deal?: { id?: string; title?: string; assigned_to?: string | null };
  old_stage?: string;
  new_stage?: string;
}

export interface WorkflowAction {
  type: string;
  execute: (data: WorkflowEventData) => Promise<void>;
}

/**
 * Any JSON value that can arrive in a jsonb config/condition column.
 * Replaces the `any` escape hatch (#1341): engine reads are type-checked
 * against this union instead of silently passing anything through.
 */
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
  enabled: boolean;
  category: string;
  last_run_at?: string;
  run_count?: number;
 
 
  config?: Record<string, ConfigValue>;
}

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value?: ConfigValue;
}

/**
 * Union of every action config key the automation engine understands (see
 * `executeAction` in engine.ts). The index signature tolerates extra keys
 * stored in tenant jsonb configs; known keys keep their precise types.
 */
export interface AutomationActionConfig {
  to?: string;
  subject?: string;
  body?: string;
  user_id?: string;
  title?: string;
  link?: string;
  resource?: string;
  id_field?: string;
  field?: string;
  value?: ConfigValue;
  priority?: string;
  assigned_to?: string;
  sequence_id?: string;
  direction?: string;
  duration?: number;
  notes?: string;
  phone_number?: string;
  template_name?: string;
  language?: string;
  template_components?: ConfigValue[];
  url?: string;
  pipeline_id?: string;
  stage_id?: string;
  amount?: string;
  tag?: string;
  [key: string]: ConfigValue | undefined;
}

export interface AutomationAction {
  type: string;
  config?: AutomationActionConfig;
}

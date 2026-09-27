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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>;
}

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export interface AutomationActionConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AutomationAction {
  type: string;
  config?: AutomationActionConfig;
}

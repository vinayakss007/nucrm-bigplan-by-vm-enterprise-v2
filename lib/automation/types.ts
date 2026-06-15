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

export interface WorkflowAction {
  type: string;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (data: any) => Promise<void>;
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

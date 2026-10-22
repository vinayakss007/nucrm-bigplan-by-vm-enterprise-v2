/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — engagement & automation entities (forms, sequences,
 * automations, reports) and their Create/Update projections.
 */

// ─── Resource Types ─────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
}

export interface Form {
  id: string;
  tenantId: string;
  title: string;
  fields: FormField[];
  status: string;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
}

export interface SequenceStep {
  type: string;
  delay?: number;
  template?: string;
  config?: Record<string, unknown>;
}

export interface Sequence {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  steps: SequenceStep[];
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationAction {
  type: string;
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  tenantId: string;
  name: string;
  trigger: string;
  actions: AutomationAction[];
  status: string;
  runCount: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Create/Update Types ────────────────────────────────────────────────────

export type CreateForm = Omit<Form, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'submissionCount'>;
export type UpdateForm = Partial<Pick<Form, 'title' | 'fields' | 'status'>>;

export type CreateSequence = Omit<Sequence, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'enrolledCount'>;
export type UpdateSequence = Partial<Pick<Sequence, 'name' | 'status' | 'steps'>>;

export type CreateAutomation = Omit<Automation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'runCount' | 'lastRunAt'>;
export type UpdateAutomation = Partial<Pick<Automation, 'name' | 'trigger' | 'actions' | 'status'>>;

export type CreateReport = Omit<Report, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'lastRunAt'>;

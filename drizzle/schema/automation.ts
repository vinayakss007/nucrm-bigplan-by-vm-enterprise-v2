import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, boolean, integer, numeric, decimal, index, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import { contacts, leads, deals } from './crm';
import * as utils from './utils';

// ── 0. LEGACY AUTOMATIONS (for backward compatibility) ──
// This table is used by existing API routes at /api/tenant/automations/*
export const automations = pgTable('automations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  triggerType: text('trigger_type').notNull().default('event'),
  triggerConfig: jsonb('trigger_config').default({}),
  actions: jsonb('actions').notNull().default([]),
  conditions: jsonb('conditions').default({}),
  runCount: integer('run_count').default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const automationRuns = pgTable('automation_runs', {
  id: utils.pk(),
  automationId: uuid('automation_id').references(() => automations.id, { onDelete: 'set null' }),
  tenantId: utils.tenantId(),
  status: text('status').notNull().default('running'),
  triggerEvent: text('trigger_event'),
  triggerEntity: text('trigger_entity'),
  triggerEntityId: uuid('trigger_entity_id'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  stepsCompleted: integer('steps_completed').default(0),
  totalSteps: integer('total_steps').default(0),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    automationIdx: index('idx_automation_runs_automation').on(table.automationId),
    tenantIdx: utils.tenantIdx(table),
    statusIdx: index('idx_automation_runs_status').on(table.status, table.startedAt),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 1. WORKFLOW ENGINE ────────────────────────────────
export const workflows = pgTable('workflows', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'), // 'draft', 'active', 'paused', 'archived'
  triggerType: text('trigger_type').notNull().default('manual'), // 'manual', 'schedule', 'event', 'webhook'
  triggerConfig: jsonb('trigger_config').notNull().default({}),
  nodes: jsonb('nodes').notNull().default([]), // For visual builder
  edges: jsonb('edges').notNull().default([]), // For visual builder
  isActive: boolean('is_active').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table).where(sql`deleted_at IS NULL AND is_active = true`),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const workflowActions = pgTable('workflow_actions', {
  id: utils.pk(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  actionType: text('action_type').notNull(), // 'email', 'whatsapp', 'update_field', 'webhook', 'delay'
  config: jsonb('config').notNull().default({}),
  conditionConfig: jsonb('condition_config'),
  orderIndex: integer('order_index').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    workflowOrderIdx: index('idx_workflow_actions_workflow').on(table.workflowId, table.orderIndex),
    tenantIdx: utils.tenantIdx(table),
  };
});

export const workflowExecutions = pgTable('workflow_executions', {
  id: utils.pk(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('running'), // 'running', 'completed', 'failed', 'cancelled'
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  errorMessage: text('error_message'),
  metadata: utils.metadata(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    workflowIdx: index('idx_workflow_executions_workflow').on(table.workflowId, table.startedAt),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const workflowActionLogs = pgTable('workflow_action_logs', {
  id: utils.pk(),
  executionId: uuid('execution_id').notNull().references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  actionId: uuid('action_id').references(() => workflowActions.id, { onDelete: 'set null' }),
  tenantId: utils.tenantId(),
  status: text('status').notNull().default('pending'), // 'pending', 'running', 'success', 'failed', 'skipped'
  errorMessage: text('error_message'),
  result: jsonb('result'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    executionIdx: index('idx_workflow_action_logs_execution').on(table.executionId),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 2. WEBHOOKS ───────────────────────────────────────
export const webhooks = pgTable('webhooks', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  events: jsonb('events').notNull().default([]),
  secret: text('secret'),
  isActive: boolean('is_active').default(true),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  webhookId: uuid('webhook_id').references(() => webhooks.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull().default('generic'),
  payload: jsonb('payload'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('success'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    webhookIdx: index('idx_webhook_deliv_webhook').on(table.webhookId),
    statusIdx: index('idx_webhook_deliv_status').on(table.status),
    payloadGinIdx: utils.metadataIdx(table),
  };
});

// ── 3. AI CORE & INSIGHTS ─────────────────────────────
export const aiInsights = pgTable('ai_insights', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  type: text('type').notNull(),
  title: text('title'),
  content: text('content').notNull(),
  priority: text('priority').default('medium'),
  score: numeric('score', { precision: 5, scale: 2 }),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  isRead: boolean('is_read').default(false),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const aiUsageLogs = pgTable('ai_usage_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id),
  feature: text('feature').notNull(),
  model: text('model'),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  tokensUsed: integer('tokens_used').default(0),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }),
  costEstimate: numeric('cost_estimate', { precision: 10, scale: 5 }),
  responseTimeMs: integer('response_time_ms'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    featureIdx: index('idx_ai_usage_logs_feature').on(table.tenantId, table.feature, table.createdAt),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// Alias for compatibility if needed
export const aiUsage = aiUsageLogs;

export const aiEmailDrafts = pgTable('ai_email_drafts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  purpose: text('purpose').notNull().default('follow_up'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  tone: text('tone').default('professional'),
  length: text('length').default('medium'),
  modelUsed: text('model_used'),
  tokensUsed: integer('tokens_used'),
  isSent: boolean('is_sent').notNull().default(false),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    userCreatedAtIdx: index('idx_ai_email_drafts_user').on(table.tenantId, table.createdBy, table.createdAt),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 4. AI CONTENT & OPPORTUNITIES ─────────────────────
export const contentGenerations = pgTable('content_generations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  contentType: text('content_type').notNull(),
  platform: text('platform'),
  inputPrompt: text('input_prompt'),
  outputContent: text('output_content'),
  modelUsed: text('model_used'),
  tokensUsed: integer('tokens_used').default(0),
  costCents: integer('cost_cents').default(0),
  status: text('status').default('draft'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const revenueOpportunities = pgTable('revenue_opportunities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  opportunityType: text('opportunity_type').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  reason: text('reason'),
  suggestedAction: text('suggested_action'),
  status: text('status').notNull().default('new'),
  metadata: utils.metadata(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
  actedAt: timestamp('acted_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 5. AI MODULE CONFIGS ──────────────────────────────
export const aiModuleConfigs = pgTable('ai_module_configs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  moduleName: text('module_name').notNull(),
  enabled: boolean('enabled').default(false),
  config: jsonb('config').default({}),
  usageStats: jsonb('usage_stats').default({}),
  planRequirement: text('plan_requirement').default('starter'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueModule: uniqueIndex('idx_ai_module_config_unique').on(table.tenantId, table.moduleName),
    tenantIdx: utils.tenantIdx(table),
    configGinIdx: index('idx_ai_module_config_gin').on(table.config),
  };
});

// ── 6. AI USAGE AGGREGATED ───────────────────────────
export const aiUsageAggregated = pgTable('ai_usage_aggregated', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  moduleName: text('module_name').notNull(),
  billingPeriod: text('billing_period').notNull(), // 'YYYY-MM'
  count: bigint('count', { mode: 'number' }).default(0),
  tokensUsed: bigint('tokens_used', { mode: 'number' }).default(0),
  costCents: bigint('cost_cents', { mode: 'number' }).default(0),
  includedInPlan: bigint('included_in_plan', { mode: 'number' }).default(0),
  overageCount: bigint('overage_count', { mode: 'number' }).default(0),
  overageCostCents: bigint('overage_cost_cents', { mode: 'number' }).default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueUsage: uniqueIndex('idx_ai_usage_agg_unique').on(table.tenantId, table.moduleName, table.billingPeriod),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 7. AUTOMATION WORKFLOWS ──────────────────────────
// Tenant-specific workflow configurations (links tenants to prebuilt workflows)
export const automationWorkflows = pgTable('automation_workflows', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  workflowId: uuid('workflow_id'),
  name: text('name').notNull(),
  description: text('description'),
  enabled: boolean('enabled').default(true),
  config: jsonb('config').default({}),
  ...utils.audit(),
}, (table) => {
  return {
    tenantWorkflowIdx: uniqueIndex('idx_automation_workflows_tenant_workflow').on(table.tenantId, table.workflowId),
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 8. WORKFLOW EXECUTION LOGS ────────────────────────
export const workflowExecutionLogs = pgTable('workflow_execution_logs', {
  id: utils.pk(),
  workflowExecutionId: uuid('workflow_execution_id').references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  message: text('message').notNull(),
  level: text('level').default('info'),
  stepName: text('step_name'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    executionIdx: index('idx_workflow_execution_logs_execution').on(table.workflowExecutionId),
    tenantIdx: utils.tenantIdx(table),
    levelIdx: index('idx_workflow_execution_logs_level').on(table.level, table.createdAt),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 9. DEAD LETTER QUEUE ───────────────────────────────
export const deadLetterQueue = pgTable('dead_letter_queue', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  jobType: text('job_type').notNull(),
  jobId: text('job_id'),
  
  queue: text('queue').notNull(),
  payload: jsonb('payload').notNull(),
  
  errorMessage: text('error_message').notNull(),
  errorStack: text('error_stack'),
  attempts: integer('attempts').default(0),
  maxAttempts: integer('max_attempts').default(3),
  
  status: text('status').notNull().default('pending'),
  
  originalRunAt: timestamp('original_run_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolution: text('resolution'),

  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    statusIdx: index('idx_dead_letter_status').on(table.status, table.tenantId),
    jobTypeIdx: index('idx_dead_letter_job_type').on(table.jobType),
    createdIdx: index('idx_dead_letter_created').on(table.createdAt),
  };
});

// ── Scheduled Reports ─────────────────────────────────────
export const scheduledReports = pgTable('scheduled_reports', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  name: text('name').notNull(),
  type: text('type').notNull(), // 'pipeline', 'revenue', 'contacts', 'performance'
  frequency: text('frequency').notNull(), // 'hourly', 'daily', 'weekly', 'monthly'

  recipients: jsonb('recipients').default([]), // email array
  config: jsonb('config').default({}), // filters, grouping, etc.

  format: text('format').default('pdf'), // 'pdf', 'csv', 'xlsx'
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),

  status: text('status').notNull().default('active'), // 'active', 'paused', 'error'

  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    statusIdx: index('idx_scheduled_reports_status').on(table.status, table.tenantId),
    nextRunIdx: index('idx_scheduled_reports_next_run').on(table.nextRunAt),
  };
});

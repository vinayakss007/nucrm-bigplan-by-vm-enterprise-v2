/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tenant data wipe used by the restore flow (#2225).
 *
 * Lives on its own so `tenant-data-import.ts` stays under the file-size cap
 * and the (long) dependency-ordered table list has exactly one home. The
 * statements run INSIDE the caller's transaction — the atomic restore needs
 * the wipe and the import to share one COMMIT/ROLLBACK boundary.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Drizzle transaction handle accepted by the wipe helpers. */
export type WipeTransaction = {
  execute: (query: SQL) => Promise<unknown>;
};

/**
 * Parameterized junction table deletes.
 * Returns a Drizzle SQL fragment — no raw SQL, no string interpolation.
 */
export function junctionDelete(table: string, tenantId: string): SQL {
  switch (table) {
    case 'contact_emails':
      return sql`DELETE FROM contact_emails WHERE contact_id IN (SELECT id FROM contacts WHERE tenant_id = ${tenantId})`;
    case 'contact_tags':
      return sql`DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE tenant_id = ${tenantId})`;
    case 'lead_tags':
      return sql`DELETE FROM lead_tags WHERE lead_id IN (SELECT id FROM leads WHERE tenant_id = ${tenantId})`;
    default:
      throw new Error(`Unknown junction table: ${table}`);
  }
}

/**
 * Tables wiped before a restore, in reverse dependency order (children before
 * parents). Hard-coded constant — never built from user input.
 */
export const TENANT_DELETE_ORDER = [
  'deal_products',
  'quote_line_items',
  'quotes',
  'price_book_entries',
  'price_books',
  'products',
  'workflow_action_logs',
  'workflow_execution_logs',
  'workflow_actions',
  'workflows',
  'automation_runs',
  'automation_workflows',
  'automations',
  'sequence_step_logs',
  'sequence_steps',
  'sequence_enrollments',
  'sequences',
  'whatsapp_messages',
  'email_warmup_logs',
  'email_warmup_pool',
  'email_warmup_configs',
  'call_notes',
  'call_recordings',
  'conversation_keywords',
  'conversation_metrics',
  'churn_predictions',
  'deal_forecasts',
  'revenue_projections',
  'pipeline_health_metrics',
  'ai_usage_logs',
  'contact_scores',
  'ai_email_drafts',
  'ai_insights',
  'report_executions',
  'saved_reports',
  'dashboards',
  'failed_webhooks',
  'webhook_deliveries',
  'webhook_inbound_logs',
  'webhooks',
  'api_key_usage',
  'api_keys',
  'impersonation_sessions',
  'audit_logs',
  'contact_merge_history',
  'contact_lifecycle_history',
  'lead_activities',
  'lead_scoring_rules',
  'sso_providers',
  'integrations',
  'record_permissions',
  'field_permissions',
  'file_uploads',
  'file_attachments',
  'notes',
  'form_submissions',
  'forms',
  'tenant_modules',
  'modules',
  'meetings',
  'email_log',
  'email_tracking',
  'email_templates',
  'contact_emails',
  'contact_tags',
  'lead_tags',
  'billing_events',
  'usage_snapshots',
  'usage_alerts',
  'limit_violations',
  'custom_field_defs',
  'onboarding_progress',
  'subscriptions',
  'invitations',
  'tenant_members',
  'roles',
  'tags',
  'tasks',
  'notifications',
  'activities',
  'deals',
  'deal_stages',
  'pipelines',
  'leads',
  'contacts',
  'companies',
];

export const JUNCTION_TABLES = ['contact_emails', 'contact_tags', 'lead_tags'];

/**
 * Delete all data for one tenant inside an existing transaction.
 *
 * `failFast` (the atomic restore path) lets the first failed statement abort
 * the whole transaction — Postgres marks an aborted transaction 25P02 and
 * every later statement would fail anyway, so catching per-table and
 * "continuing" only produces a COMMIT that silently persists nothing.
 * Legacy callers keep the old tolerant behavior with `failFast: false`.
 */
export async function deleteTenantDataInTx(
  tx: WipeTransaction,
  tenantId: string,
  options: { skipTables?: string[]; failFast?: boolean } = {},
): Promise<void> {
  const { skipTables = [], failFast = true } = options;
  for (const table of TENANT_DELETE_ORDER) {
    if (skipTables.includes(table)) continue;
    const statement: SQL = JUNCTION_TABLES.includes(table)
      ? junctionDelete(table, tenantId)
      : sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`;
    if (failFast) {
      await tx.execute(statement);
      continue;
    }
    try {
      await tx.execute(statement);
    } catch (e) {
      console.warn('[Import] Delete failed for table:', table, e);
    }
  }
}

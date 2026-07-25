/**
 * Shared SQL allowlist for dynamic table/column identifiers.
 *
 * All dynamic `sql.identifier()` calls MUST validate table names
 * against this allowlist before use. Column names derived from
 * database row keys are safe (they come from the schema), but
 * column names from untrusted sources (backup files, user input)
 * must also be validated.
 */

// Union of all known tenant-scoped tables used by restore, import, and backup
const VALID_TABLES = new Set([
  // Core CRM
  'contacts', 'leads', 'deals', 'companies', 'tasks', 'notes', 'activities',
  'activity_logs', 'tags', 'contact_tags', 'lead_tags', 'deal_stages',
  'pipeline_stages', 'custom_fields', 'attachments', 'file_uploads',

  // Users & Auth
  'users', 'roles', 'tenant_members', 'tenants', 'sessions', 'refresh_tokens',
  'invitations', 'email_verifications',

  // Billing & Subscriptions
  'plans', 'subscriptions', 'billing_events', 'usage_snapshots', 'usage_alerts',
  'limit_violations',

  // Email
  'email_templates', 'email_sequences', 'email_tracking', 'email_log',
  'email_warmup_configs', 'email_warmup_pool', 'email_warmup_logs',

  // Automation
  'automation_rules', 'automation_runs', 'automation_steps', 'workflows',
  'workflow_actions', 'workflow_execution_logs', 'workflow_action_logs',
  'automations', 'automation_workflows',

  // Webhooks & Integrations
  'webhooks', 'webhook_deliveries', 'webhook_inbound_logs', 'failed_webhooks',
  'integrations',

  // Support
  'support_tickets', 'ticket_replies', 'error_logs',

  // AI
  'ai_insights', 'ai_email_drafts', 'contact_scores', 'ai_usage_logs',
  'churn_predictions', 'deal_forecasts', 'revenue_projections',
  'pipeline_health_metrics',

  // Reports & Dashboards
  'saved_reports', 'report_executions', 'dashboards',

  // API Keys
  'api_keys', 'api_key_usage',

  // Lead Management
  'lead_scoring_rules', 'lead_activities',

  // Contact Intelligence
  'contact_lifecycle_history', 'contact_merge_history',

  // Audit
  'audit_logs', 'impersonation_sessions',

  // Modules & Forms
  'tenant_modules', 'modules', 'forms', 'form_submissions',

  // Meetings & Calls
  'meetings', 'call_recordings', 'call_notes',

  // Conversations
  'conversation_metrics', 'conversation_keywords',

  // Sequences
  'sequences', 'sequence_enrollments', 'sequence_steps', 'sequence_step_logs',

  // WhatsApp
  'whatsapp_messages',

  // Products & Quotes
  'products', 'price_books', 'price_book_entries', 'quotes', 'quote_line_items',
  'contracts', 'invoices',

  // Follow-ups & Tickets
  'follow_ups', 'tickets', 'kb_articles',

  // Misc
  'queue_jobs', 'notifications', 'onboarding_progress',
  'active_impersonation_sessions', 'file_attachments',
]);

/**
 * Validate a table name against the allowlist.
 * @throws Error if the table name is not in the allowlist.
 */
export function validateTableName(table: string): string {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: "${table}". Table names must be from the allowlist.`);
  }
  return table;
}

/**
 * Check if a table name is valid without throwing.
 */
export function isValidTableName(table: string): boolean {
  return VALID_TABLES.has(table);
}

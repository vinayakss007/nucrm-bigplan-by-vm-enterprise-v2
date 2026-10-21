/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The set of tables the backup parser treats as tenant-scoped, split out of
 * lib/restore/backup-parser.ts under #422.
 *
 * tests/unit/tenant-junction-scoping.test.ts pins that this list stays
 * deliberately uncentralised — merging it into the app's tenant scoping is
 * #2809's decision, not this file's.
 */

// Tables that have tenant_id column
// Updated: 2026-04-15 — Removed non-tenant tables (users, sessions, refresh_tokens, health_checks)
// Added missing tables from migrations 045, 047, 048, 049
export const TENANT_SCOPED_TABLES = new Set([
  // Core CRM tables
  'tenants', 'contacts', 'leads', 'deals', 'tasks', 'companies',
  'activities', 'deal_stages', 'pipelines', 'tags',

  // Communication
  'sequences', 'sequence_enrollments', 'sequence_steps', 'sequence_step_logs',
  'email_templates', 'email_tracking', 'email_log',
  'email_warmup_configs', 'email_warmup_pool', 'email_warmup_logs',
  'whatsapp_messages',

  // Automation & workflows
  'automations', 'automation_runs', 'automation_workflows',
  'workflows', 'workflow_actions', 'workflow_action_logs', 'workflow_execution_logs',

  // AI & analytics
  'ai_insights', 'ai_email_drafts', 'ai_usage_logs',
  'contact_scores', 'churn_predictions', 'deal_forecasts',
  'revenue_projections', 'pipeline_health_metrics',

  // Reports & dashboards
  'saved_reports', 'report_executions', 'dashboards',

  // Integrations & webhooks
  'webhooks', 'webhook_deliveries', 'webhook_inbound_logs',
  'failed_webhooks', 'api_keys', 'api_key_usage', 'integrations',

  // Enterprise features
  'field_permissions', 'record_permissions',
  'products', 'price_books', 'price_book_entries',
  'quotes', 'quote_line_items', 'sso_providers',

  // Lead management
  'lead_scoring_rules', 'lead_activities',

  // Contact lifecycle & merge
  'contact_lifecycle_history', 'contact_merge_history',
  'contact_emails', 'contact_tags', 'lead_tags',

  // Meetings & calls
  'meetings', 'call_recordings', 'call_notes',
  'conversation_metrics', 'conversation_keywords',
  'call_logs',

  // Notes & files
  'notes', 'file_uploads', 'file_attachments',

  // Forms & modules
  'forms', 'form_submissions',
  'modules', 'tenant_modules',

  // Billing & usage
  'billing_events', 'usage_snapshots', 'usage_alerts',
  'limit_violations', 'announcements',
  'custom_field_defs', 'deal_products',

  // Tenant settings
  'roles', 'tenant_members', 'invitations',
  'onboarding_progress', 'subscriptions',
  'notifications', 'audit_logs', 'impersonation_sessions',

  // Backup/restore tracking (per-tenant data)
  'tenant_backup_records', 'tenant_restore_records',
  'backup_schedules', 'critical_data_backups',
  'selective_restore_logs', 'selective_restore_audit_log',
  'restore_snapshots',
]);

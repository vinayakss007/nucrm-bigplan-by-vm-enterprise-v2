-- Rollback for 0002_flat_sir_ram
-- 0002 re-declares every table from 0000_init (135) plus 78 new tables.
-- Rolling back restores the pre-0002 state: drop only the 78 tables that
-- were introduced here. Tables shared with 0000_init are owned by that
-- migration and are dropped by ITS rollback.

BEGIN;

DROP TABLE IF EXISTS ai_activity CASCADE;
DROP TABLE IF EXISTS ai_draft_templates CASCADE;
DROP TABLE IF EXISTS ai_provider_secrets CASCADE;
DROP TABLE IF EXISTS approval_requests CASCADE;
DROP TABLE IF EXISTS assignment_logs CASCADE;
DROP TABLE IF EXISTS assignment_rules CASCADE;
DROP TABLE IF EXISTS at_risk_rules CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS comm_email_drafts CASCADE;
DROP TABLE IF EXISTS compliance_requests CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS custom_plugins CASCADE;
DROP TABLE IF EXISTS dashboard_layouts CASCADE;
DROP TABLE IF EXISTS data_retention_policies CASCADE;
DROP TABLE IF EXISTS dead_letter_queue CASCADE;
DROP TABLE IF EXISTS document_folders CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS edit_history CASCADE;
DROP TABLE IF EXISTS email_clicks CASCADE;
DROP TABLE IF EXISTS email_opens CASCADE;
DROP TABLE IF EXISTS email_warmup_logs CASCADE;
DROP TABLE IF EXISTS exchange_rates CASCADE;
DROP TABLE IF EXISTS field_snapshots CASCADE;
DROP TABLE IF EXISTS follow_ups CASCADE;
DROP TABLE IF EXISTS hierarchy_permissions CASCADE;
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS invoice_payments CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS kb_articles CASCADE;
DROP TABLE IF EXISTS kb_categories CASCADE;
DROP TABLE IF EXISTS lead_offers CASCADE;
DROP TABLE IF EXISTS lead_warming_campaigns CASCADE;
DROP TABLE IF EXISTS lead_warming_events CASCADE;
DROP TABLE IF EXISTS lead_warming_messages CASCADE;
DROP TABLE IF EXISTS lead_warming_replies CASCADE;
DROP TABLE IF EXISTS lead_warming_schedule CASCADE;
DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS login_blocks CASCADE;
DROP TABLE IF EXISTS milestones CASCADE;
DROP TABLE IF EXISTS oauth_clients CASCADE;
DROP TABLE IF EXISTS oauth_codes CASCADE;
DROP TABLE IF EXISTS oauth_tokens CASCADE;
DROP TABLE IF EXISTS order_line_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS page_views CASCADE;
DROP TABLE IF EXISTS plan_limits CASCADE;
DROP TABLE IF EXISTS plugin_execution_logs CASCADE;
DROP TABLE IF EXISTS portal_clients CASCADE;
DROP TABLE IF EXISTS product_templates CASCADE;
DROP TABLE IF EXISTS project_tasks CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS restore_snapshots CASCADE;
DROP TABLE IF EXISTS saved_views CASCADE;
DROP TABLE IF EXISTS scheduled_reports CASCADE;
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS service_categories CASCADE;
DROP TABLE IF EXISTS service_subscriptions CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS signing_events CASCADE;
DROP TABLE IF EXISTS signing_requests CASCADE;
DROP TABLE IF EXISTS sla_breaches CASCADE;
DROP TABLE IF EXISTS sla_policies CASCADE;
DROP TABLE IF EXISTS sms_messages CASCADE;
DROP TABLE IF EXISTS sms_templates CASCADE;
DROP TABLE IF EXISTS storage_documents CASCADE;
DROP TABLE IF EXISTS super_admin_audit_logs CASCADE;
DROP TABLE IF EXISTS tax_exemptions CASCADE;
DROP TABLE IF EXISTS tax_rates CASCADE;
DROP TABLE IF EXISTS tenant_backup_records CASCADE;
DROP TABLE IF EXISTS tenant_hierarchy CASCADE;
DROP TABLE IF EXISTS tenant_restore_records CASCADE;
DROP TABLE IF EXISTS tenant_templates CASCADE;
DROP TABLE IF EXISTS territories CASCADE;
DROP TABLE IF EXISTS territory_assignments CASCADE;
DROP TABLE IF EXISTS user_usage CASCADE;
DROP TABLE IF EXISTS visitors CASCADE;
DROP TABLE IF EXISTS webhook_queue CASCADE;

COMMIT;

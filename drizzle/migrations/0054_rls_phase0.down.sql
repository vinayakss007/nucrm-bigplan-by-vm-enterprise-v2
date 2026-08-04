-- Migration 0054 down: Disable RLS on the 38 tables

DROP POLICY IF EXISTS plans_read_all ON plans;
DROP POLICY IF EXISTS plans_super_admin_write ON plans;
ALTER TABLE plans DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_limits_read_all ON plan_limits;
DROP POLICY IF EXISTS plan_limits_super_admin_write ON plan_limits;
ALTER TABLE plan_limits DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS modules_read_all ON modules;
DROP POLICY IF EXISTS modules_super_admin_write ON modules;
ALTER TABLE modules DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_registry_read_all ON feature_registry;
DROP POLICY IF EXISTS feature_registry_super_admin_write ON feature_registry;
ALTER TABLE feature_registry DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_rates_read_all ON exchange_rates;
DROP POLICY IF EXISTS exchange_rates_super_admin_write ON exchange_rates;
ALTER TABLE exchange_rates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_templates_read_all ON dashboard_templates;
DROP POLICY IF EXISTS dashboard_templates_super_admin_write ON dashboard_templates;
ALTER TABLE dashboard_templates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_templates_read_all ON report_templates;
DROP POLICY IF EXISTS report_templates_super_admin_write ON report_templates;
ALTER TABLE report_templates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_templates_read_all ON product_templates;
DROP POLICY IF EXISTS product_templates_super_admin_write ON product_templates;
ALTER TABLE product_templates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_read_all ON system_settings;
DROP POLICY IF EXISTS system_settings_super_admin_write ON system_settings;
ALTER TABLE system_settings DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_read_all ON announcements;
DROP POLICY IF EXISTS announcements_super_admin_write ON announcements;
ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_registry_read_all ON api_keys_registry;
DROP POLICY IF EXISTS api_keys_registry_super_admin_write ON api_keys_registry;
ALTER TABLE api_keys_registry DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS token_budgets_read_all ON token_budgets;
DROP POLICY IF EXISTS token_budgets_super_admin_write ON token_budgets;
ALTER TABLE token_budgets DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_alerts_read_all ON usage_alerts;
DROP POLICY IF EXISTS usage_alerts_super_admin_write ON usage_alerts;
ALTER TABLE usage_alerts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_checks_read_all ON health_checks;
DROP POLICY IF EXISTS health_checks_super_admin_write ON health_checks;
ALTER TABLE health_checks DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backup_records_read_all ON backup_records;
DROP POLICY IF EXISTS backup_records_super_admin_write ON backup_records;
ALTER TABLE backup_records DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backup_alerts_read_all ON backup_alerts;
DROP POLICY IF EXISTS backup_alerts_super_admin_write ON backup_alerts;
ALTER TABLE backup_alerts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_audit_logs_super_admin_only ON super_admin_audit_logs;
ALTER TABLE super_admin_audit_logs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_backups_super_admin_only ON super_admin_backups;
ALTER TABLE super_admin_backups DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_hierarchy_super_admin_only ON tenant_hierarchy;
ALTER TABLE tenant_hierarchy DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_read_all ON tenants;
DROP POLICY IF EXISTS tenants_authenticated_insert ON tenants;
DROP POLICY IF EXISTS tenants_authenticated_update ON tenants;
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_read_self ON users;
DROP POLICY IF EXISTS users_super_admin_read ON users;
DROP POLICY IF EXISTS users_insert_auth ON users;
DROP POLICY IF EXISTS users_update_own ON users;
DROP POLICY IF EXISTS users_super_admin_update ON users;
DROP POLICY IF EXISTS users_super_admin_delete ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_user_own ON sessions;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refresh_tokens_user_own ON refresh_tokens;
ALTER TABLE refresh_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oauth_tokens_user_own ON oauth_tokens;
ALTER TABLE oauth_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oauth_codes_user_own ON oauth_codes;
ALTER TABLE oauth_codes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS password_resets_user_own ON password_resets;
ALTER TABLE password_resets DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_verifications_user_own ON email_verifications;
ALTER TABLE email_verifications DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_emails_tenant_isolation ON contact_emails;
ALTER TABLE contact_emails DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_tags_tenant_isolation ON contact_tags;
ALTER TABLE contact_tags DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_tags_tenant_isolation ON lead_tags;
ALTER TABLE lead_tags DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_stages_tenant_isolation ON pipeline_stages;
ALTER TABLE pipeline_stages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_book_entries_tenant_isolation ON price_book_entries;
ALTER TABLE price_book_entries DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_warmup_logs_tenant_isolation ON email_warmup_logs;
ALTER TABLE email_warmup_logs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_warmup_pool_tenant_isolation ON email_warmup_pool;
ALTER TABLE email_warmup_pool DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_queue_tenant_isolation ON webhook_queue;
ALTER TABLE webhook_queue DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_attempts_super_admin_only ON login_attempts;
ALTER TABLE login_attempts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_blocks_super_admin_only ON login_blocks;
ALTER TABLE login_blocks DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hierarchy_permissions_read_all ON hierarchy_permissions;
DROP POLICY IF EXISTS hierarchy_permissions_super_admin_write ON hierarchy_permissions;
ALTER TABLE hierarchy_permissions DISABLE ROW LEVEL SECURITY;

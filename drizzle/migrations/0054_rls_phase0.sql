-- Migration 0054: Phase 0 — Enable RLS on 38 remaining tables
-- All policies are ADDITIVE (no existing policies are removed)
-- Strategy: deny-by-default → explicit allow per role
-- SAFETY: All GUC checks use `!= ''` guard to avoid ''::uuid crash
--         when called from webhooks/cron that don't set tenant context

-- ============================================================
-- CATEGORY 1: System-wide tables (super_admin writes, all users read)
-- ============================================================

-- plans
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read_all ON plans FOR SELECT USING (true);
CREATE POLICY plans_super_admin_write ON plans FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- plan_limits
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_limits_read_all ON plan_limits FOR SELECT USING (true);
CREATE POLICY plan_limits_super_admin_write ON plan_limits FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- modules
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY modules_read_all ON modules FOR SELECT USING (true);
CREATE POLICY modules_super_admin_write ON modules FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- feature_registry
ALTER TABLE feature_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_registry_read_all ON feature_registry FOR SELECT USING (true);
CREATE POLICY feature_registry_super_admin_write ON feature_registry FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- exchange_rates
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY exchange_rates_read_all ON exchange_rates FOR SELECT USING (true);
CREATE POLICY exchange_rates_super_admin_write ON exchange_rates FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- dashboard_templates
ALTER TABLE dashboard_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_templates_read_all ON dashboard_templates FOR SELECT USING (true);
CREATE POLICY dashboard_templates_super_admin_write ON dashboard_templates FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- report_templates
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_templates_read_all ON report_templates FOR SELECT USING (true);
CREATE POLICY report_templates_super_admin_write ON report_templates FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- product_templates
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_templates_read_all ON product_templates FOR SELECT USING (true);
CREATE POLICY product_templates_super_admin_write ON product_templates FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- system_settings
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_settings_read_all ON system_settings FOR SELECT USING (true);
CREATE POLICY system_settings_super_admin_write ON system_settings FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_read_all ON announcements FOR SELECT USING (true);
CREATE POLICY announcements_super_admin_write ON announcements FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- api_keys_registry
ALTER TABLE api_keys_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_registry_read_all ON api_keys_registry FOR SELECT USING (true);
CREATE POLICY api_keys_registry_super_admin_write ON api_keys_registry FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- token_budgets
ALTER TABLE token_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY token_budgets_read_all ON token_budgets FOR SELECT USING (true);
CREATE POLICY token_budgets_super_admin_write ON token_budgets FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- usage_alerts
ALTER TABLE usage_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_alerts_read_all ON usage_alerts FOR SELECT USING (true);
CREATE POLICY usage_alerts_super_admin_write ON usage_alerts FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- health_checks
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY health_checks_read_all ON health_checks FOR SELECT USING (true);
CREATE POLICY health_checks_super_admin_write ON health_checks FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- backup_records
ALTER TABLE backup_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY backup_records_read_all ON backup_records FOR SELECT USING (true);
CREATE POLICY backup_records_super_admin_write ON backup_records FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- backup_alerts
ALTER TABLE backup_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY backup_alerts_read_all ON backup_alerts FOR SELECT USING (true);
CREATE POLICY backup_alerts_super_admin_write ON backup_alerts FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- ============================================================
-- CATEGORY 2: Super admin only tables
-- ============================================================

-- super_admin_audit_logs
ALTER TABLE super_admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY super_admin_audit_logs_super_admin_only ON super_admin_audit_logs FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- super_admin_backups
ALTER TABLE super_admin_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY super_admin_backups_super_admin_only ON super_admin_backups FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- tenant_hierarchy
ALTER TABLE tenant_hierarchy ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_hierarchy_super_admin_only ON tenant_hierarchy FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- tenants (read all, any authenticated user can update for webhook support)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_read_all ON tenants FOR SELECT USING (true);
CREATE POLICY tenants_authenticated_insert ON tenants FOR INSERT WITH CHECK (
  current_setting('app.current_user', true) != ''
);
CREATE POLICY tenants_authenticated_update ON tenants FOR UPDATE USING (
  current_setting('app.current_user', true) != ''
);

-- users (cross-tenant, super_admin can see all, users see themselves)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_read_self ON users FOR SELECT USING (
  current_setting('app.current_user', true) != '' AND
  id = current_setting('app.current_user', true)::uuid
);
CREATE POLICY users_super_admin_read ON users FOR SELECT USING (
  current_setting('app.is_super_admin', true)::boolean = true
);
CREATE POLICY users_insert_auth ON users FOR INSERT WITH CHECK (
  current_setting('app.current_user', true) != ''
);
CREATE POLICY users_update_own ON users FOR UPDATE USING (
  current_setting('app.current_user', true) != '' AND
  id = current_setting('app.current_user', true)::uuid
);
CREATE POLICY users_super_admin_update ON users FOR UPDATE USING (
  current_setting('app.is_super_admin', true)::boolean = true
);
CREATE POLICY users_super_admin_delete ON users FOR DELETE USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- ============================================================
-- CATEGORY 3: User-scoped tables (user owns their own rows)
-- ============================================================

-- sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_user_own ON sessions FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- refresh_tokens
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_user_own ON refresh_tokens FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- oauth_tokens
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_tokens_user_own ON oauth_tokens FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- oauth_codes
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_codes_user_own ON oauth_codes FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- password_resets
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY password_resets_user_own ON password_resets FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- email_verifications
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_verifications_user_own ON email_verifications FOR ALL USING (
  current_setting('app.current_user', true) != '' AND
  user_id = current_setting('app.current_user', true)::uuid
);

-- ============================================================
-- CATEGORY 4: Tenant join tables (subquery to parent entity)
-- ============================================================

-- contact_emails → contacts (tenant_id)
ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_emails_tenant_isolation ON contact_emails FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_emails.contact_id
      AND c.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- contact_tags → contacts (tenant_id)
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_tags_tenant_isolation ON contact_tags FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_tags.contact_id
      AND c.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- lead_tags → leads (tenant_id)
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_tags_tenant_isolation ON lead_tags FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_tags.lead_id
      AND l.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- pipeline_stages → pipelines (tenant_id)
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_stages_tenant_isolation ON pipeline_stages FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_stages.pipeline_id
      AND p.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- price_book_entries → price_books (tenant_id)
ALTER TABLE price_book_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_book_entries_tenant_isolation ON price_book_entries FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM price_books pb
    WHERE pb.id = price_book_entries.price_book_id
      AND pb.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- email_warmup_logs → email_warmup_configs (tenant_id)
ALTER TABLE email_warmup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_warmup_logs_tenant_isolation ON email_warmup_logs FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM email_warmup_configs ewc
    WHERE ewc.id = email_warmup_logs.config_id
      AND ewc.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- email_warmup_pool → email_warmup_configs (tenant_id)
ALTER TABLE email_warmup_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_warmup_pool_tenant_isolation ON email_warmup_pool FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM email_warmup_configs ewc
    WHERE ewc.id = email_warmup_pool.config_id
      AND ewc.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- webhook_queue → webhooks (tenant_id)
ALTER TABLE webhook_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_queue_tenant_isolation ON webhook_queue FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  EXISTS (
    SELECT 1 FROM webhooks w
    WHERE w.id = webhook_queue.webhook_id
      AND w.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- ============================================================
-- CATEGORY 5: Global security tables (super_admin only)
-- ============================================================

-- login_attempts
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY login_attempts_super_admin_only ON login_attempts FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- login_blocks
ALTER TABLE login_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY login_blocks_super_admin_only ON login_blocks FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

-- ============================================================
-- CATEGORY 6: Hierarchy permissions (global reference table)
-- ============================================================

-- hierarchy_permissions
ALTER TABLE hierarchy_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hierarchy_permissions_read_all ON hierarchy_permissions FOR SELECT USING (true);
CREATE POLICY hierarchy_permissions_super_admin_write ON hierarchy_permissions FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

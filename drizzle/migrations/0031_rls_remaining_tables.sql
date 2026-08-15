-- 0031: Enable RLS on remaining tenant-scoped tables
-- Covers: AI, automation, billing, chat, comms, CRM, documents, financial,
-- infra, knowledge, lead-warming, marketing, plugins, projects, segments,
-- services, support, templates, tokens, visitors, webhooks, workflows, etc.
--
-- Uses same pattern as 0015_rls_policies.sql: tenant_id = current_setting('app.current_tenant')::uuid
-- Special handling for platform_settings which has global (NULL tenant_id) rows.

DO $$
DECLARE
  tables_with_tenant_id text[] := ARRAY[
    -- AI
    'ai_activity', 'ai_credits_ledger', 'ai_draft_templates', 'ai_email_drafts',
    'ai_insights', 'ai_module_configs', 'ai_provider_secrets', 'ai_usage_aggregated', 'ai_usage_logs',
    -- API / Key usage
    'api_key_usage', 'api_key_usage_infra',
    -- Approval / Assignment
    'approval_requests', 'assignment_logs', 'assignment_rules',
    -- Automation
    'at_risk_rules', 'automation_runs', 'automation_workflows',
    -- Backup / Billing
    'backup_schedules', 'billing_events',
    -- Calls / Communications
    'call_logs', 'call_notes', 'call_recordings',
    'chat_messages', 'chat_sessions', 'churn_predictions',
    'comm_email_drafts',
    -- Compliance
    'compliance_requests',
    -- Contact / CRM helpers
    'contact_lifecycle_history', 'contact_merge_history', 'contact_scores',
    -- Content / Contracts
    'content_generations', 'contracts',
    -- Conversation / Cost
    'conversation_keywords', 'conversation_metrics', 'cost_anomalies',
    -- Custom / Dashboard / Data
    'critical_data_backups', 'custom_field_defs', 'custom_plugins',
    'dashboard_layouts', 'dashboards', 'data_retention_policies',
    -- Dead letter
    'dead_letter_queue',
    -- Deal helpers
    'deal_forecasts', 'deal_products',
    -- Documents
    'document_folders', 'documents', 'storage_documents',
    -- Edit history
    'edit_history',
    -- Email
    'email_clicks', 'email_log', 'email_opens', 'email_templates', 'email_tracking',
    'email_warmup_configs',
    -- Entities / Errors
    'entity_tags', 'error_logs', 'failed_webhooks',
    -- Fields / Files
    'field_permissions', 'field_snapshots',
    'file_attachments', 'file_uploads',
    -- Follow-ups / Forms
    'follow_ups', 'form_submissions', 'forms',
    -- Impersonation / Integration
    'impersonation_sessions', 'integrations',
    -- Invitations
    'invitations',
    -- Invoicing
    'invoices',
    -- Knowledge base
    'kb_articles', 'kb_categories',
    -- Lead helpers
    'lead_activities', 'lead_assignments', 'lead_offers', 'lead_scoring_rules',
    'lead_warming_campaigns', 'lead_warming_events', 'lead_warming_messages',
    'lead_warming_replies', 'lead_warming_schedule', 'leads',
    -- Limits
    'limit_violations',
    -- Milestones
    'milestones',
    -- OAuth
    'oauth_clients',
    -- Onboarding
    'onboarding_progress',
    -- Orders
    'orders',
    -- Pages / Permissions / Pipelines
    'page_views', 'permission_overrides',
    'pipeline_health_metrics', 'pipelines',
    -- Plugins
    'plugin_execution_logs', 'portal_clients',
    -- Products / Pricing
    'price_books', 'products',
    -- Projects
    'project_tasks', 'projects',
    -- Quotes
    'quotes',
    -- Record permissions
    'record_permissions',
    -- Reports
    'report_executions', 'saved_reports', 'saved_views', 'scheduled_reports',
    -- Restore / Revenue
    'restore_snapshots', 'selective_restore_audit_log', 'selective_restore_logs',
    'revenue_forecast_summary', 'revenue_opportunities', 'revenue_projections',
    -- Roles
    'roles',
    -- Security / Segments
    'security_events', 'segment_members', 'segments',
    -- Sequences
    'sequence_enrollments', 'sequence_step_logs', 'sequence_steps', 'sequences',
    -- Services / Subscriptions
    'service_categories', 'service_subscriptions', 'services',
    -- Signing
    'signing_events', 'signing_requests',
    -- SLA
    'sla_breaches', 'sla_policies',
    -- SMS
    'sms_messages', 'sms_templates',
    -- SSO
    'sso_providers', 'sso_sessions',
    -- Subscriptions
    'subscriptions',
    -- Super admin audit
    'super_admin_audit_logs',
    -- Support
    'support_tickets',
    -- Tags
    'tags',
    -- Tax
    'tax_exemptions', 'tax_rates',
    -- Tenant internals
    'tenant_ai_credits', 'tenant_backup_records', 'tenant_backups',
    'tenant_members', 'tenant_modules',
    'tenant_restore_records', 'tenant_restores',
    'tenant_templates', 'tenant_token_limits',
    -- Territories
    'territories', 'territory_assignments',
    -- Ticket replies
    'ticket_replies',
    -- Usage
    'usage_snapshots',
    -- User helpers
    'user_departures', 'user_token_limits', 'user_usage',
    -- Visitors
    'visitors',
    -- Voice
    'voice_calls',
    -- Webhooks
    'webhook_inbound_logs', 'webhooks',
    -- WhatsApp
    'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_templates',
    -- Workflows
    'workflow_action_logs', 'workflow_actions',
    'workflow_execution_logs', 'workflow_executions', 'workflows'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables_with_tenant_id
  LOOP
    -- Skip tables that don't exist yet (e.g. not yet migrated)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'Skipping RLS for %: table does not exist', t;
      CONTINUE;
    END IF;

    -- Skip tables that don't have a tenant_id column (e.g. deal_stages, invoice_line_items, etc.)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'Skipping RLS for %: no tenant_id column', t;
      CONTINUE;
    END IF;

    -- Enable RLS (safe to call if already enabled)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);

    -- Drop any existing policy first to avoid conflicts
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);

    -- Create standard tenant isolation policy
    -- Cast tenant_id to text for comparison to handle both text and uuid column types
    EXECUTE format('
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id IS NULL OR tenant_id::text = current_setting(''app.current_tenant''))
      WITH CHECK (tenant_id::text = current_setting(''app.current_tenant''))
    ', t);
  END LOOP;

  -- Special case: platform_settings has global rows (tenant_id IS NULL) + per-tenant rows.
  -- Allow both: global rows accessible to all, per-tenant rows scoped normally.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'platform_settings'
  ) THEN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', 'platform_settings');
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', 'platform_settings');
    EXECUTE format('
      CREATE POLICY tenant_isolation ON platform_settings
        FOR ALL
        USING (
          tenant_id IS NULL
          OR tenant_id::text = current_setting(''app.current_tenant'')
        )
        WITH CHECK (
          tenant_id::text = current_setting(''app.current_tenant'')
        );
    ');
  END IF;
END $$;

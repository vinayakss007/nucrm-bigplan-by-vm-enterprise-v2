-- Migration 0055: JSONB size limits on remaining 179 columns
-- Adds 64KB max size constraint on all JSONB columns not already covered
-- by migration 0051 (which covered contacts, companies, deals, leads, tasks)
-- CHECK constraints ARE enforced even for table owners (unlike RLS)

-- ============================================================
-- All remaining JSONB columns get 64KB size limit
-- Pattern: (col IS NULL OR jsonb_size_bytes(col) <= 65536)
-- ============================================================

-- activities
ALTER TABLE activities ADD CONSTRAINT chk_activities_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- ai_activity
ALTER TABLE ai_activity ADD CONSTRAINT chk_ai_activity_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- ai_email_drafts
ALTER TABLE ai_email_drafts ADD CONSTRAINT chk_ai_email_drafts_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- ai_insights
ALTER TABLE ai_insights ADD CONSTRAINT chk_ai_insights_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- ai_module_configs
ALTER TABLE ai_module_configs ADD CONSTRAINT chk_ai_module_configs_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);
ALTER TABLE ai_module_configs ADD CONSTRAINT chk_ai_module_configs_usage_stats_size
  CHECK (usage_stats IS NULL OR jsonb_size_bytes(usage_stats) <= 65536);

-- ai_usage_logs
ALTER TABLE ai_usage_logs ADD CONSTRAINT chk_ai_usage_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- api_keys
ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_scopes_size
  CHECK (scopes IS NULL OR jsonb_size_bytes(scopes) <= 65536);

-- assignment_rules
ALTER TABLE assignment_rules ADD CONSTRAINT chk_assignment_rules_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- at_risk_rules
ALTER TABLE at_risk_rules ADD CONSTRAINT chk_at_risk_rules_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- audit_logs
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_logs_new_data_size
  CHECK (new_data IS NULL OR jsonb_size_bytes(new_data) <= 65536);
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_logs_old_data_size
  CHECK (old_data IS NULL OR jsonb_size_bytes(old_data) <= 65536);

-- automation_runs
ALTER TABLE automation_runs ADD CONSTRAINT chk_automation_runs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- automation_workflows
ALTER TABLE automation_workflows ADD CONSTRAINT chk_automation_workflows_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- automations
ALTER TABLE automations ADD CONSTRAINT chk_automations_actions_size
  CHECK (actions IS NULL OR jsonb_size_bytes(actions) <= 65536);
ALTER TABLE automations ADD CONSTRAINT chk_automations_conditions_size
  CHECK (conditions IS NULL OR jsonb_size_bytes(conditions) <= 65536);
ALTER TABLE automations ADD CONSTRAINT chk_automations_trigger_config_size
  CHECK (trigger_config IS NULL OR jsonb_size_bytes(trigger_config) <= 65536);

-- backup_records
ALTER TABLE backup_records ADD CONSTRAINT chk_backup_records_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- billing_events
ALTER TABLE billing_events ADD CONSTRAINT chk_billing_events_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- call_logs
ALTER TABLE call_logs ADD CONSTRAINT chk_call_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- canned_responses
ALTER TABLE canned_responses ADD CONSTRAINT chk_canned_responses_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- churn_predictions
ALTER TABLE churn_predictions ADD CONSTRAINT chk_churn_predictions_risk_factors_size
  CHECK (risk_factors IS NULL OR jsonb_size_bytes(risk_factors) <= 65536);

-- comm_email_drafts
ALTER TABLE comm_email_drafts ADD CONSTRAINT chk_comm_email_drafts_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- compliance_requests
ALTER TABLE compliance_requests ADD CONSTRAINT chk_compliance_requests_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE compliance_requests ADD CONSTRAINT chk_compliance_requests_result_size
  CHECK (result IS NULL OR jsonb_size_bytes(result) <= 65536);

-- contact_lifecycle_history
ALTER TABLE contact_lifecycle_history ADD CONSTRAINT chk_contact_lifecycle_history_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- contact_merge_history
ALTER TABLE contact_merge_history ADD CONSTRAINT chk_contact_merge_history_merged_fields_size
  CHECK (merged_fields IS NULL OR jsonb_size_bytes(merged_fields) <= 65536);
ALTER TABLE contact_merge_history ADD CONSTRAINT chk_contact_merge_history_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- contact_scores
ALTER TABLE contact_scores ADD CONSTRAINT chk_contact_scores_score_factors_size
  CHECK (score_factors IS NULL OR jsonb_size_bytes(score_factors) <= 65536);

-- content_generations
ALTER TABLE content_generations ADD CONSTRAINT chk_content_generations_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- contracts
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- critical_data_backups
ALTER TABLE critical_data_backups ADD CONSTRAINT chk_critical_data_backups_backup_data_size
  CHECK (backup_data IS NULL OR jsonb_size_bytes(backup_data) <= 65536);

-- csat_surveys
ALTER TABLE csat_surveys ADD CONSTRAINT chk_csat_surveys_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- custom_field_defs
ALTER TABLE custom_field_defs ADD CONSTRAINT chk_custom_field_defs_field_options_size
  CHECK (field_options IS NULL OR jsonb_size_bytes(field_options) <= 65536);

-- custom_plugins
ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_actions_size
  CHECK (actions IS NULL OR jsonb_size_bytes(actions) <= 65536);
ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_auth_config_size
  CHECK (auth_config IS NULL OR jsonb_size_bytes(auth_config) <= 65536);
ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_custom_headers_size
  CHECK (custom_headers IS NULL OR jsonb_size_bytes(custom_headers) <= 65536);
ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- dashboard_layouts
ALTER TABLE dashboard_layouts ADD CONSTRAINT chk_dashboard_layouts_layout_size
  CHECK (layout IS NULL OR jsonb_size_bytes(layout) <= 65536);

-- dashboard_templates
ALTER TABLE dashboard_templates ADD CONSTRAINT chk_dashboard_templates_filters_size
  CHECK (filters IS NULL OR jsonb_size_bytes(filters) <= 65536);
ALTER TABLE dashboard_templates ADD CONSTRAINT chk_dashboard_templates_layout_size
  CHECK (layout IS NULL OR jsonb_size_bytes(layout) <= 65536);

-- dashboards
ALTER TABLE dashboards ADD CONSTRAINT chk_dashboards_layout_size
  CHECK (layout IS NULL OR jsonb_size_bytes(layout) <= 65536);

-- data_retention_policies
ALTER TABLE data_retention_policies ADD CONSTRAINT chk_data_retention_policies_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- dead_letter_queue
ALTER TABLE dead_letter_queue ADD CONSTRAINT chk_dead_letter_queue_payload_size
  CHECK (payload IS NULL OR jsonb_size_bytes(payload) <= 65536);

-- deal_forecasts
ALTER TABLE deal_forecasts ADD CONSTRAINT chk_deal_forecasts_negative_factors_size
  CHECK (negative_factors IS NULL OR jsonb_size_bytes(negative_factors) <= 65536);
ALTER TABLE deal_forecasts ADD CONSTRAINT chk_deal_forecasts_positive_factors_size
  CHECK (positive_factors IS NULL OR jsonb_size_bytes(positive_factors) <= 65536);

-- deal_stages
ALTER TABLE deal_stages ADD CONSTRAINT chk_deal_stages_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- document_folders
ALTER TABLE document_folders ADD CONSTRAINT chk_document_folders_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- documents
ALTER TABLE documents ADD CONSTRAINT chk_documents_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- dunning_attempts
ALTER TABLE dunning_attempts ADD CONSTRAINT chk_dunning_attempts_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- dunning_settings
ALTER TABLE dunning_settings ADD CONSTRAINT chk_dunning_settings_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE dunning_settings ADD CONSTRAINT chk_dunning_settings_retry_schedule_size
  CHECK (retry_schedule IS NULL OR jsonb_size_bytes(retry_schedule) <= 65536);

-- email_templates
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- email_tracking
ALTER TABLE email_tracking ADD CONSTRAINT chk_email_tracking_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- email_warmup_logs
ALTER TABLE email_warmup_logs ADD CONSTRAINT chk_email_warmup_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- error_logs
ALTER TABLE error_logs ADD CONSTRAINT chk_error_logs_context_size
  CHECK (context IS NULL OR jsonb_size_bytes(context) <= 65536);

-- failed_webhooks
ALTER TABLE failed_webhooks ADD CONSTRAINT chk_failed_webhooks_payload_size
  CHECK (payload IS NULL OR jsonb_size_bytes(payload) <= 65536);

-- feature_registry
ALTER TABLE feature_registry ADD CONSTRAINT chk_feature_registry_entities_size
  CHECK (entities IS NULL OR jsonb_size_bytes(entities) <= 65536);
ALTER TABLE feature_registry ADD CONSTRAINT chk_feature_registry_metadata_keys_size
  CHECK (metadata_keys IS NULL OR jsonb_size_bytes(metadata_keys) <= 65536);
ALTER TABLE feature_registry ADD CONSTRAINT chk_feature_registry_requires_tables_size
  CHECK (requires_tables IS NULL OR jsonb_size_bytes(requires_tables) <= 65536);

-- follow_ups
ALTER TABLE follow_ups ADD CONSTRAINT chk_follow_ups_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- form_submissions
ALTER TABLE form_submissions ADD CONSTRAINT chk_form_submissions_data_size
  CHECK (data IS NULL OR jsonb_size_bytes(data) <= 65536);

-- forms
ALTER TABLE forms ADD CONSTRAINT chk_forms_fields_size
  CHECK (fields IS NULL OR jsonb_size_bytes(fields) <= 65536);
ALTER TABLE forms ADD CONSTRAINT chk_forms_settings_size
  CHECK (settings IS NULL OR jsonb_size_bytes(settings) <= 65536);
ALTER TABLE forms ADD CONSTRAINT chk_forms_theme_size
  CHECK (theme IS NULL OR jsonb_size_bytes(theme) <= 65536);

-- integrations
ALTER TABLE integrations ADD CONSTRAINT chk_integrations_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- invoices
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- kb_articles
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- lead_activities
ALTER TABLE lead_activities ADD CONSTRAINT chk_lead_activities_activity_data_size
  CHECK (activity_data IS NULL OR jsonb_size_bytes(activity_data) <= 65536);
ALTER TABLE lead_activities ADD CONSTRAINT chk_lead_activities_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- lead_offers
ALTER TABLE lead_offers ADD CONSTRAINT chk_lead_offers_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- lead_warming_campaigns
ALTER TABLE lead_warming_campaigns ADD CONSTRAINT chk_lead_warming_campaigns_event_ids_size
  CHECK (event_ids IS NULL OR jsonb_size_bytes(event_ids) <= 65536);
ALTER TABLE lead_warming_campaigns ADD CONSTRAINT chk_lead_warming_campaigns_target_filter_size
  CHECK (target_filter IS NULL OR jsonb_size_bytes(target_filter) <= 65536);

-- lead_warming_events
ALTER TABLE lead_warming_events ADD CONSTRAINT chk_lead_warming_events_channels_size
  CHECK (channels IS NULL OR jsonb_size_bytes(channels) <= 65536);
ALTER TABLE lead_warming_events ADD CONSTRAINT chk_lead_warming_events_tags_size
  CHECK (tags IS NULL OR jsonb_size_bytes(tags) <= 65536);

-- lead_warming_messages
ALTER TABLE lead_warming_messages ADD CONSTRAINT chk_lead_warming_messages_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- lead_warming_replies
ALTER TABLE lead_warming_replies ADD CONSTRAINT chk_lead_warming_replies_ai_extracted_entities_size
  CHECK (ai_extracted_entities IS NULL OR jsonb_size_bytes(ai_extracted_entities) <= 65536);
ALTER TABLE lead_warming_replies ADD CONSTRAINT chk_lead_warming_replies_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- milestones
ALTER TABLE milestones ADD CONSTRAINT chk_milestones_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- modules
ALTER TABLE modules ADD CONSTRAINT chk_modules_manifest_size
  CHECK (manifest IS NULL OR jsonb_size_bytes(manifest) <= 65536);

-- notifications
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- orders
ALTER TABLE orders ADD CONSTRAINT chk_orders_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- permission_overrides
ALTER TABLE permission_overrides ADD CONSTRAINT chk_permission_overrides_permissions_size
  CHECK (permissions IS NULL OR jsonb_size_bytes(permissions) <= 65536);

-- pipeline_stages
ALTER TABLE pipeline_stages ADD CONSTRAINT chk_pipeline_stages_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- pipelines
ALTER TABLE pipelines ADD CONSTRAINT chk_pipelines_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- plans
ALTER TABLE plans ADD CONSTRAINT chk_plans_features_size
  CHECK (features IS NULL OR jsonb_size_bytes(features) <= 65536);
ALTER TABLE plans ADD CONSTRAINT chk_plans_rate_limit_config_size
  CHECK (rate_limit_config IS NULL OR jsonb_size_bytes(rate_limit_config) <= 65536);

-- platform_settings
ALTER TABLE platform_settings ADD CONSTRAINT chk_platform_settings_value_size
  CHECK (value IS NULL OR jsonb_size_bytes(value) <= 65536);

-- plugin_execution_logs
ALTER TABLE plugin_execution_logs ADD CONSTRAINT chk_plugin_execution_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE plugin_execution_logs ADD CONSTRAINT chk_plugin_execution_logs_request_body_size
  CHECK (request_body IS NULL OR jsonb_size_bytes(request_body) <= 65536);
ALTER TABLE plugin_execution_logs ADD CONSTRAINT chk_plugin_execution_logs_request_headers_size
  CHECK (request_headers IS NULL OR jsonb_size_bytes(request_headers) <= 65536);

-- product_templates
ALTER TABLE product_templates ADD CONSTRAINT chk_product_templates_automations_size
  CHECK (automations IS NULL OR jsonb_size_bytes(automations) <= 65536);
ALTER TABLE product_templates ADD CONSTRAINT chk_product_templates_custom_fields_size
  CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE product_templates ADD CONSTRAINT chk_product_templates_modules_size
  CHECK (modules IS NULL OR jsonb_size_bytes(modules) <= 65536);
ALTER TABLE product_templates ADD CONSTRAINT chk_product_templates_pipelines_size
  CHECK (pipelines IS NULL OR jsonb_size_bytes(pipelines) <= 65536);

-- products
ALTER TABLE products ADD CONSTRAINT chk_products_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- projects
ALTER TABLE projects ADD CONSTRAINT chk_projects_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- quotes
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- report_executions
ALTER TABLE report_executions ADD CONSTRAINT chk_report_executions_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- report_templates
ALTER TABLE report_templates ADD CONSTRAINT chk_report_templates_chart_config_size
  CHECK (chart_config IS NULL OR jsonb_size_bytes(chart_config) <= 65536);
ALTER TABLE report_templates ADD CONSTRAINT chk_report_templates_query_config_size
  CHECK (query_config IS NULL OR jsonb_size_bytes(query_config) <= 65536);

-- restore_snapshots
ALTER TABLE restore_snapshots ADD CONSTRAINT chk_restore_snapshots_snapshot_data_size
  CHECK (snapshot_data IS NULL OR jsonb_size_bytes(snapshot_data) <= 65536);

-- revenue_opportunities
ALTER TABLE revenue_opportunities ADD CONSTRAINT chk_revenue_opportunities_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- revenue_projections
ALTER TABLE revenue_projections ADD CONSTRAINT chk_revenue_projections_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- roles
ALTER TABLE roles ADD CONSTRAINT chk_roles_permissions_size
  CHECK (permissions IS NULL OR jsonb_size_bytes(permissions) <= 65536);

-- saved_reports
ALTER TABLE saved_reports ADD CONSTRAINT chk_saved_reports_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- saved_views
ALTER TABLE saved_views ADD CONSTRAINT chk_saved_views_columns_size
  CHECK (columns IS NULL OR jsonb_size_bytes(columns) <= 65536);
ALTER TABLE saved_views ADD CONSTRAINT chk_saved_views_filters_size
  CHECK (filters IS NULL OR jsonb_size_bytes(filters) <= 65536);
ALTER TABLE saved_views ADD CONSTRAINT chk_saved_views_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- scheduled_reports
ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);
ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_recipients_size
  CHECK (recipients IS NULL OR jsonb_size_bytes(recipients) <= 65536);

-- segments
ALTER TABLE segments ADD CONSTRAINT chk_segments_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);
ALTER TABLE segments ADD CONSTRAINT chk_segments_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE segments ADD CONSTRAINT chk_segments_query_logic_size
  CHECK (query_logic IS NULL OR jsonb_size_bytes(query_logic) <= 65536);

-- selective_restore_audit_log
ALTER TABLE selective_restore_audit_log ADD CONSTRAINT chk_selective_restore_audit_log_new_data_size
  CHECK (new_data IS NULL OR jsonb_size_bytes(new_data) <= 65536);
ALTER TABLE selective_restore_audit_log ADD CONSTRAINT chk_selective_restore_audit_log_old_data_size
  CHECK (old_data IS NULL OR jsonb_size_bytes(old_data) <= 65536);

-- sequence_enrollments
ALTER TABLE sequence_enrollments ADD CONSTRAINT chk_sequence_enrollments_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- sequence_steps
ALTER TABLE sequence_steps ADD CONSTRAINT chk_sequence_steps_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- sequences
ALTER TABLE sequences ADD CONSTRAINT chk_sequences_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- service_subscriptions
ALTER TABLE service_subscriptions ADD CONSTRAINT chk_service_subscriptions_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- services
ALTER TABLE services ADD CONSTRAINT chk_services_custom_fields_size
  CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE services ADD CONSTRAINT chk_services_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- signing_events
ALTER TABLE signing_events ADD CONSTRAINT chk_signing_events_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- signing_requests
ALTER TABLE signing_requests ADD CONSTRAINT chk_signing_requests_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE signing_requests ADD CONSTRAINT chk_signing_requests_signers_size
  CHECK (signers IS NULL OR jsonb_size_bytes(signers) <= 65536);

-- sla_breaches
ALTER TABLE sla_breaches ADD CONSTRAINT chk_sla_breaches_notified_users_size
  CHECK (notified_users IS NULL OR jsonb_size_bytes(notified_users) <= 65536);

-- sla_policies
ALTER TABLE sla_policies ADD CONSTRAINT chk_sla_policies_escalation_rules_size
  CHECK (escalation_rules IS NULL OR jsonb_size_bytes(escalation_rules) <= 65536);

-- sms_templates
ALTER TABLE sms_templates ADD CONSTRAINT chk_sms_templates_variables_size
  CHECK (variables IS NULL OR jsonb_size_bytes(variables) <= 65536);

-- sso_providers
ALTER TABLE sso_providers ADD CONSTRAINT chk_sso_providers_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- storage_documents
ALTER TABLE storage_documents ADD CONSTRAINT chk_storage_documents_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- subscriptions
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- support_tickets
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- system_settings
ALTER TABLE system_settings ADD CONSTRAINT chk_system_settings_value_size
  CHECK (value IS NULL OR jsonb_size_bytes(value) <= 65536);

-- tags
ALTER TABLE tags ADD CONSTRAINT chk_tags_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- tenant_backup_records
ALTER TABLE tenant_backup_records ADD CONSTRAINT chk_tenant_backup_records_backup_data_size
  CHECK (backup_data IS NULL OR jsonb_size_bytes(backup_data) <= 65536);
ALTER TABLE tenant_backup_records ADD CONSTRAINT chk_tenant_backup_records_include_tables_size
  CHECK (include_tables IS NULL OR jsonb_size_bytes(include_tables) <= 65536);

-- tenant_backups
ALTER TABLE tenant_backups ADD CONSTRAINT chk_tenant_backups_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- tenant_members
ALTER TABLE tenant_members ADD CONSTRAINT chk_tenant_members_notification_prefs_size
  CHECK (notification_prefs IS NULL OR jsonb_size_bytes(notification_prefs) <= 65536);
ALTER TABLE tenant_members ADD CONSTRAINT chk_tenant_members_settings_size
  CHECK (settings IS NULL OR jsonb_size_bytes(settings) <= 65536);

-- tenant_modules
ALTER TABLE tenant_modules ADD CONSTRAINT chk_tenant_modules_enabled_features_size
  CHECK (enabled_features IS NULL OR jsonb_size_bytes(enabled_features) <= 65536);
ALTER TABLE tenant_modules ADD CONSTRAINT chk_tenant_modules_settings_size
  CHECK (settings IS NULL OR jsonb_size_bytes(settings) <= 65536);

-- tenant_restore_records
ALTER TABLE tenant_restore_records ADD CONSTRAINT chk_tenant_restore_records_restore_options_size
  CHECK (restore_options IS NULL OR jsonb_size_bytes(restore_options) <= 65536);

-- tenant_restores
ALTER TABLE tenant_restores ADD CONSTRAINT chk_tenant_restores_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- tenants
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_settings_size
  CHECK (settings IS NULL OR jsonb_size_bytes(settings) <= 65536);

-- territories
ALTER TABLE territories ADD CONSTRAINT chk_territories_geo_config_size
  CHECK (geo_config IS NULL OR jsonb_size_bytes(geo_config) <= 65536);

-- ticket_replies
ALTER TABLE ticket_replies ADD CONSTRAINT chk_ticket_replies_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- usage_snapshots
ALTER TABLE usage_snapshots ADD CONSTRAINT chk_usage_snapshots_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- user_usage
ALTER TABLE user_usage ADD CONSTRAINT chk_user_usage_counters_size
  CHECK (counters IS NULL OR jsonb_size_bytes(counters) <= 65536);

-- users
ALTER TABLE users ADD CONSTRAINT chk_users_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE users ADD CONSTRAINT chk_users_totp_backup_codes_size
  CHECK (totp_backup_codes IS NULL OR jsonb_size_bytes(totp_backup_codes) <= 65536);

-- voice_calls
ALTER TABLE voice_calls ADD CONSTRAINT chk_voice_calls_ai_action_items_size
  CHECK (ai_action_items IS NULL OR jsonb_size_bytes(ai_action_items) <= 65536);
ALTER TABLE voice_calls ADD CONSTRAINT chk_voice_calls_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- webhook_deliveries
ALTER TABLE webhook_deliveries ADD CONSTRAINT chk_webhook_deliveries_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE webhook_deliveries ADD CONSTRAINT chk_webhook_deliveries_payload_size
  CHECK (payload IS NULL OR jsonb_size_bytes(payload) <= 65536);

-- webhook_inbound_logs
ALTER TABLE webhook_inbound_logs ADD CONSTRAINT chk_webhook_inbound_logs_headers_size
  CHECK (headers IS NULL OR jsonb_size_bytes(headers) <= 65536);
ALTER TABLE webhook_inbound_logs ADD CONSTRAINT chk_webhook_inbound_logs_payload_size
  CHECK (payload IS NULL OR jsonb_size_bytes(payload) <= 65536);

-- webhook_queue
ALTER TABLE webhook_queue ADD CONSTRAINT chk_webhook_queue_headers_size
  CHECK (headers IS NULL OR jsonb_size_bytes(headers) <= 65536);
ALTER TABLE webhook_queue ADD CONSTRAINT chk_webhook_queue_payload_size
  CHECK (payload IS NULL OR jsonb_size_bytes(payload) <= 65536);

-- webhooks
ALTER TABLE webhooks ADD CONSTRAINT chk_webhooks_events_size
  CHECK (events IS NULL OR jsonb_size_bytes(events) <= 65536);
ALTER TABLE webhooks ADD CONSTRAINT chk_webhooks_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- whatsapp_conversations
ALTER TABLE whatsapp_conversations ADD CONSTRAINT chk_whatsapp_conversations_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- whatsapp_messages
ALTER TABLE whatsapp_messages ADD CONSTRAINT chk_whatsapp_messages_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- whatsapp_templates
ALTER TABLE whatsapp_templates ADD CONSTRAINT chk_whatsapp_templates_components_size
  CHECK (components IS NULL OR jsonb_size_bytes(components) <= 65536);
ALTER TABLE whatsapp_templates ADD CONSTRAINT chk_whatsapp_templates_meta_data_size
  CHECK (meta_data IS NULL OR jsonb_size_bytes(meta_data) <= 65536);
ALTER TABLE whatsapp_templates ADD CONSTRAINT chk_whatsapp_templates_variables_size
  CHECK (variables IS NULL OR jsonb_size_bytes(variables) <= 65536);

-- workflow_action_logs
ALTER TABLE workflow_action_logs ADD CONSTRAINT chk_workflow_action_logs_result_size
  CHECK (result IS NULL OR jsonb_size_bytes(result) <= 65536);

-- workflow_actions
ALTER TABLE workflow_actions ADD CONSTRAINT chk_workflow_actions_condition_config_size
  CHECK (condition_config IS NULL OR jsonb_size_bytes(condition_config) <= 65536);
ALTER TABLE workflow_actions ADD CONSTRAINT chk_workflow_actions_config_size
  CHECK (config IS NULL OR jsonb_size_bytes(config) <= 65536);

-- workflow_execution_logs
ALTER TABLE workflow_execution_logs ADD CONSTRAINT chk_workflow_execution_logs_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

-- workflow_executions
ALTER TABLE workflow_executions ADD CONSTRAINT chk_workflow_executions_input_data_size
  CHECK (input_data IS NULL OR jsonb_size_bytes(input_data) <= 65536);
ALTER TABLE workflow_executions ADD CONSTRAINT chk_workflow_executions_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE workflow_executions ADD CONSTRAINT chk_workflow_executions_output_data_size
  CHECK (output_data IS NULL OR jsonb_size_bytes(output_data) <= 65536);

-- workflows
ALTER TABLE workflows ADD CONSTRAINT chk_workflows_edges_size
  CHECK (edges IS NULL OR jsonb_size_bytes(edges) <= 65536);
ALTER TABLE workflows ADD CONSTRAINT chk_workflows_metadata_size
  CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE workflows ADD CONSTRAINT chk_workflows_nodes_size
  CHECK (nodes IS NULL OR jsonb_size_bytes(nodes) <= 65536);
ALTER TABLE workflows ADD CONSTRAINT chk_workflows_trigger_config_size
  CHECK (trigger_config IS NULL OR jsonb_size_bytes(trigger_config) <= 65536);

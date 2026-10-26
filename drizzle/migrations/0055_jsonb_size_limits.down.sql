-- Migration: 0055_jsonb_size_limits (down)
-- Drops the 179 CHECK constraints this migration added.
--
-- The file was a flat list of 179 `ALTER TABLE … DROP CONSTRAINT …` with no `IF EXISTS`, and
-- three of them name `pipeline_stages`, `tenant_backups` and `tenant_restores` — relations
-- that 0080_drop_pipeline_stages and 0078_drop_dead_backup_tables drop, and whose own downs
-- recreate them *structure only*, without these constraints. In a reverse-order rollback the
-- constraint is already gone when this script runs, so the first unguarded drop aborts the
-- file and the other 176 are never removed — which is exactly what leaves 0051's helper drop
-- to fail with 2BP01. This unreachable file, not 0051 itself, is why no rollback to a release
-- before 0051 completes.
--
-- Selecting from `pg_constraint` first delivers every name this migration owns regardless of
-- which relations still exist, and keeps ownership explicit: nothing here touches a constraint
-- 0055 did not create.
DO $$
DECLARE r RECORD;
BEGIN
  -- #3284: keyed on the names this migration created, not on a name pattern. Only
  -- constraints that actually exist are touched, so a relation a later migration dropped
  -- (and whose own down recreates without this constraint) cannot abort the rollback, and
  -- no later migration's guardrail is deleted on the way.
  FOR r IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint
           WHERE contype = 'c'
             AND conname IN (
             'chk_activities_metadata_size', 'chk_ai_activity_metadata_size', 'chk_ai_email_drafts_metadata_size', 'chk_ai_insights_metadata_size', 'chk_ai_module_configs_config_size',
             'chk_ai_module_configs_usage_stats_size', 'chk_ai_usage_logs_metadata_size', 'chk_api_keys_metadata_size', 'chk_api_keys_scopes_size', 'chk_assignment_rules_config_size',
             'chk_at_risk_rules_metadata_size', 'chk_audit_logs_metadata_size', 'chk_audit_logs_new_data_size', 'chk_audit_logs_old_data_size', 'chk_automation_runs_metadata_size',
             'chk_automation_workflows_config_size', 'chk_automations_actions_size', 'chk_automations_conditions_size', 'chk_automations_trigger_config_size', 'chk_backup_records_metadata_size',
             'chk_billing_events_metadata_size', 'chk_call_logs_metadata_size', 'chk_canned_responses_metadata_size', 'chk_churn_predictions_risk_factors_size', 'chk_comm_email_drafts_metadata_size',
             'chk_compliance_requests_metadata_size', 'chk_compliance_requests_result_size', 'chk_contact_lifecycle_history_metadata_size', 'chk_contact_merge_history_merged_fields_size', 'chk_contact_merge_history_metadata_size',
             'chk_contact_scores_score_factors_size', 'chk_content_generations_metadata_size', 'chk_contracts_metadata_size', 'chk_critical_data_backups_backup_data_size', 'chk_csat_surveys_metadata_size',
             'chk_custom_field_defs_field_options_size', 'chk_custom_plugins_actions_size', 'chk_custom_plugins_auth_config_size', 'chk_custom_plugins_custom_headers_size', 'chk_custom_plugins_metadata_size',
             'chk_dashboard_layouts_layout_size', 'chk_dashboard_templates_filters_size', 'chk_dashboard_templates_layout_size', 'chk_dashboards_layout_size', 'chk_data_retention_policies_metadata_size',
             'chk_dead_letter_queue_payload_size', 'chk_deal_forecasts_negative_factors_size', 'chk_deal_forecasts_positive_factors_size', 'chk_deal_stages_metadata_size', 'chk_document_folders_metadata_size',
             'chk_documents_metadata_size', 'chk_dunning_attempts_metadata_size', 'chk_dunning_settings_metadata_size', 'chk_dunning_settings_retry_schedule_size', 'chk_email_templates_metadata_size',
             'chk_email_tracking_metadata_size', 'chk_email_warmup_logs_metadata_size', 'chk_error_logs_context_size', 'chk_failed_webhooks_payload_size', 'chk_feature_registry_entities_size',
             'chk_feature_registry_metadata_keys_size', 'chk_feature_registry_requires_tables_size', 'chk_follow_ups_metadata_size', 'chk_form_submissions_data_size', 'chk_forms_fields_size',
             'chk_forms_settings_size', 'chk_forms_theme_size', 'chk_integrations_config_size', 'chk_invoices_metadata_size', 'chk_kb_articles_metadata_size',
             'chk_lead_activities_activity_data_size', 'chk_lead_activities_metadata_size', 'chk_lead_offers_metadata_size', 'chk_lead_warming_campaigns_event_ids_size', 'chk_lead_warming_campaigns_target_filter_size',
             'chk_lead_warming_events_channels_size', 'chk_lead_warming_events_tags_size', 'chk_lead_warming_messages_metadata_size', 'chk_lead_warming_replies_ai_extracted_entities_size', 'chk_lead_warming_replies_metadata_size',
             'chk_milestones_metadata_size', 'chk_modules_manifest_size', 'chk_notifications_metadata_size', 'chk_orders_metadata_size', 'chk_permission_overrides_permissions_size',
             'chk_pipeline_stages_metadata_size', 'chk_pipelines_metadata_size', 'chk_plans_features_size', 'chk_plans_rate_limit_config_size', 'chk_platform_settings_value_size',
             'chk_plugin_execution_logs_metadata_size', 'chk_plugin_execution_logs_request_body_size', 'chk_plugin_execution_logs_request_headers_size', 'chk_product_templates_automations_size', 'chk_product_templates_custom_fields_size',
             'chk_product_templates_modules_size', 'chk_product_templates_pipelines_size', 'chk_products_metadata_size', 'chk_projects_metadata_size', 'chk_quotes_metadata_size',
             'chk_report_executions_metadata_size', 'chk_report_templates_chart_config_size', 'chk_report_templates_query_config_size', 'chk_restore_snapshots_snapshot_data_size', 'chk_revenue_opportunities_metadata_size',
             'chk_revenue_projections_metadata_size', 'chk_roles_permissions_size', 'chk_saved_reports_config_size', 'chk_saved_views_columns_size', 'chk_saved_views_filters_size',
             'chk_saved_views_metadata_size', 'chk_scheduled_reports_config_size', 'chk_scheduled_reports_recipients_size', 'chk_segments_config_size', 'chk_segments_metadata_size',
             'chk_segments_query_logic_size', 'chk_selective_restore_audit_log_new_data_size', 'chk_selective_restore_audit_log_old_data_size', 'chk_sequence_enrollments_metadata_size', 'chk_sequence_steps_metadata_size',
             'chk_sequences_metadata_size', 'chk_service_subscriptions_metadata_size', 'chk_services_custom_fields_size', 'chk_services_metadata_size', 'chk_signing_events_metadata_size',
             'chk_signing_requests_metadata_size', 'chk_signing_requests_signers_size', 'chk_sla_breaches_notified_users_size', 'chk_sla_policies_escalation_rules_size', 'chk_sms_templates_variables_size',
             'chk_sso_providers_config_size', 'chk_storage_documents_metadata_size', 'chk_subscriptions_metadata_size', 'chk_support_tickets_metadata_size', 'chk_system_settings_value_size',
             'chk_tags_metadata_size', 'chk_tenant_backup_records_backup_data_size', 'chk_tenant_backup_records_include_tables_size', 'chk_tenant_backups_metadata_size', 'chk_tenant_members_notification_prefs_size',
             'chk_tenant_members_settings_size', 'chk_tenant_modules_enabled_features_size', 'chk_tenant_modules_settings_size', 'chk_tenant_restore_records_restore_options_size', 'chk_tenant_restores_metadata_size',
             'chk_tenants_metadata_size', 'chk_tenants_settings_size', 'chk_territories_geo_config_size', 'chk_ticket_replies_metadata_size', 'chk_usage_snapshots_metadata_size',
             'chk_user_usage_counters_size', 'chk_users_metadata_size', 'chk_users_totp_backup_codes_size', 'chk_voice_calls_ai_action_items_size', 'chk_voice_calls_metadata_size',
             'chk_webhook_deliveries_metadata_size', 'chk_webhook_deliveries_payload_size', 'chk_webhook_inbound_logs_headers_size', 'chk_webhook_inbound_logs_payload_size', 'chk_webhook_queue_headers_size',
             'chk_webhook_queue_payload_size', 'chk_webhooks_events_size', 'chk_webhooks_metadata_size', 'chk_whatsapp_conversations_metadata_size', 'chk_whatsapp_messages_metadata_size',
             'chk_whatsapp_templates_components_size', 'chk_whatsapp_templates_meta_data_size', 'chk_whatsapp_templates_variables_size', 'chk_workflow_action_logs_result_size', 'chk_workflow_actions_condition_config_size',
             'chk_workflow_actions_config_size', 'chk_workflow_execution_logs_metadata_size', 'chk_workflow_executions_input_data_size', 'chk_workflow_executions_metadata_size', 'chk_workflow_executions_output_data_size',
             'chk_workflows_edges_size', 'chk_workflows_metadata_size', 'chk_workflows_nodes_size', 'chk_workflows_trigger_config_size'
             )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

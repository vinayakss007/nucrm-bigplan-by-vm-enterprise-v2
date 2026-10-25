-- Migration: 0050_data_validation_checks (down)
-- Drops the 115 CHECK constraints this migration added.
--
-- The loop used to read `conname LIKE 'chk_%'` while its own comment counted 99. `chk_%` is
-- every CHECK constraint in the database: against the real chain the guard measures its reach
-- at 440 constraints created by seven LATER migrations (0051, 0052, 0053, 0055, 0056, 0057,
-- 0111), and on a scratch schema built from 0000 + those ups the old script dropped 168 of
-- 168 and reported success. A rollback scoped to this migration therefore removed every jsonb
-- size limit and every text length limit in the schema.
--
-- Name-scoped now, and `npm run guard:rollback-coverage` fails a pattern that reaches a
-- later migration's constraints (FOREIGN_OBJECT), which is what #3284 ask 3 asks for.
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
             'chk_contacts_lead_status', 'chk_leads_lead_status', 'chk_custom_field_defs_entity_type', 'chk_custom_field_defs_field_type', 'chk_entity_tags_entity_type',
             'chk_notes_entity_type', 'chk_segments_entity_type', 'chk_follow_ups_status', 'chk_meetings_status', 'chk_lead_offers_status',
             'chk_tasks_status', 'chk_tasks_priority', 'chk_support_tickets_status', 'chk_support_tickets_priority', 'chk_invoices_status',
             'chk_quotes_status', 'chk_orders_status', 'chk_contracts_status', 'chk_contracts_contract_type', 'chk_workflows_status',
             'chk_workflows_trigger_type', 'chk_workflow_executions_status', 'chk_workflow_action_logs_status', 'chk_scheduled_reports_status', 'chk_scheduled_reports_type',
             'chk_scheduled_reports_frequency', 'chk_scheduled_reports_format', 'chk_sequences_status', 'chk_sequence_step_logs_status', 'chk_sequence_enrollments_status',
             'chk_sequence_steps_step_type', 'chk_approval_requests_status', 'chk_field_permissions_access_level', 'chk_record_permissions_access_level', 'chk_notifications_type',
             'chk_team_members_role', 'chk_territories_type', 'chk_territory_assignments_role', 'chk_signing_requests_status', 'chk_signing_requests_provider',
             'chk_signing_events_event', 'chk_compliance_requests_type', 'chk_compliance_requests_status', 'chk_data_retention_policies_entity_type', 'chk_data_retention_policies_action',
             'chk_announcements_type', 'chk_announcements_target', 'chk_custom_plugins_status', 'chk_custom_plugins_auth_type', 'chk_tenant_modules_status',
             'chk_product_templates_status', 'chk_projects_status', 'chk_chat_sessions_status', 'chk_chat_messages_sender_type', 'chk_sla_policies_priority',
             'chk_sla_breaches_entity_type', 'chk_sla_breaches_breach_type', 'chk_assignment_rules_type', 'chk_assignment_rules_entity_type', 'chk_ai_activity_status',
             'chk_ai_activity_action', 'chk_ai_draft_templates_kind', 'chk_ai_provider_secrets_key_type', 'chk_tenant_ai_credits_status', 'chk_lead_warming_events_event_type',
             'chk_lead_warming_events_recurrence', 'chk_lead_warming_campaigns_status', 'chk_lead_warming_messages_status', 'chk_lead_warming_messages_channel', 'chk_lead_warming_replies_intent',
             'chk_lead_warming_replies_sentiment', 'chk_email_log_status', 'chk_integrations_type', 'chk_call_logs_direction', 'chk_deals_amount_nonneg',
             'chk_quotes_total_amount_nonneg', 'chk_invoices_total_amount_nonneg', 'chk_invoices_discount_amount_nonneg', 'chk_invoices_tax_amount_nonneg', 'chk_invoices_amount_paid_nonneg',
             'chk_orders_total_amount_nonneg', 'chk_orders_discount_amount_nonneg', 'chk_orders_tax_amount_nonneg', 'chk_orders_shipping_amount_nonneg', 'chk_invoice_line_items_unit_price_nonneg',
             'chk_invoice_line_items_discount_amount_nonneg', 'chk_invoice_line_items_tax_amount_nonneg', 'chk_order_line_items_unit_price_nonneg', 'chk_quote_line_items_unit_price_nonneg', 'chk_deal_products_price_nonneg',
             'chk_lead_offers_unit_price_nonneg', 'chk_plans_price_nonneg', 'chk_plans_price_monthly_nonneg', 'chk_plans_price_yearly_nonneg', 'chk_products_base_price_nonneg',
             'chk_price_book_entries_unit_price_nonneg', 'chk_services_unit_price_nonneg', 'chk_services_monthly_price_nonneg', 'chk_services_yearly_price_nonneg', 'chk_billing_events_amount_nonneg',
             'chk_invoice_payments_amount_nonneg', 'chk_dunning_attempts_payment_amount_nonneg', 'chk_service_subscriptions_amount_nonneg', 'chk_companies_annual_revenue_nonneg', 'chk_services_total_revenue_nonneg',
             'chk_revenue_projections_projected_amount_nonneg', 'chk_revenue_projections_actual_amount_nonneg', 'chk_revenue_forecast_summary_total_expected_revenue_nonneg', 'chk_ai_usage_logs_cost_cents_nonneg', 'chk_ai_activity_cost_cents_nonneg',
             'chk_ai_credits_ledger_cost_cents_nonneg', 'chk_content_generations_cost_cents_nonneg', 'chk_voice_calls_cost_cents_nonneg', 'chk_tenant_ai_credits_allocated_cost_cents_nonneg', 'chk_tenant_ai_credits_used_cost_cents_nonneg'
             )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

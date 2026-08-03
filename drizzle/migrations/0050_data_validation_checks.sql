-- Migration: 0050_data_validation_checks
--
-- Adds 99 CHECK constraints on status/type/priority/role/amount columns
-- to reject unexpected values at the database level. Protects against
-- integration data corruption, webhook garbage, and API misuse.

-- ═══════════════════════════════════════════════════════════════════════════
-- CRM MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE contacts ADD CONSTRAINT chk_contacts_lead_status
  CHECK (lead_status IN ('new','contacted','qualified','proposal','negotiation','won','lost','archived','disqualified','unqualified','converted'));

ALTER TABLE leads ADD CONSTRAINT chk_leads_lead_status
  CHECK (lead_status IN ('new','contacted','qualified','converted','rejected','junk','archived','unqualified'));

ALTER TABLE custom_field_defs ADD CONSTRAINT chk_custom_field_defs_entity_type
  CHECK (entity_type IN ('contact','deal','company','lead','task'));

ALTER TABLE custom_field_defs ADD CONSTRAINT chk_custom_field_defs_field_type
  CHECK (field_type IN ('text','number','date','select','multiselect','boolean','url','email','phone','currency','json'));

ALTER TABLE entity_tags ADD CONSTRAINT chk_entity_tags_entity_type
  CHECK (entity_type IN ('contact','deal','company','lead'));

ALTER TABLE notes ADD CONSTRAINT chk_notes_entity_type
  CHECK (entity_type IN ('contact','deal','company','lead'));

ALTER TABLE segments ADD CONSTRAINT chk_segments_entity_type
  CHECK (entity_type IN ('contact','deal','company','lead'));

ALTER TABLE follow_ups ADD CONSTRAINT chk_follow_ups_status
  CHECK (status IN ('pending','completed','missed','cancelled'));

ALTER TABLE meetings ADD CONSTRAINT chk_meetings_status
  CHECK (status IN ('scheduled','completed','cancelled','no_show','rescheduled','waiting_acceptance'));

ALTER TABLE lead_offers ADD CONSTRAINT chk_lead_offers_status
  CHECK (status IN ('proposed','accepted','rejected','withdrawn'));

-- ═══════════════════════════════════════════════════════════════════════════
-- TASKS MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status
  CHECK (status IN ('pending','in_progress','completed','cancelled','deferred','on_hold'));

ALTER TABLE tasks ADD CONSTRAINT chk_tasks_priority
  CHECK (priority IN ('low','medium','high','urgent'));

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPORT MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_status
  CHECK (status IN ('open','in_progress','waiting','closed','pending_customer','escalated','resolved','on_hold'));

ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_priority
  CHECK (priority IN ('low','medium','high','urgent'));

-- ═══════════════════════════════════════════════════════════════════════════
-- BILLING MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE invoices ADD CONSTRAINT chk_invoices_status
  CHECK (status IN ('draft','sent','paid','overdue','cancelled','partially_paid','written_off','pending'));

ALTER TABLE quotes ADD CONSTRAINT chk_quotes_status
  CHECK (status IN ('draft','sent','viewed','accepted','declined','expired','pending','expired_pending','converted','cancelled'));

ALTER TABLE orders ADD CONSTRAINT chk_orders_status
  CHECK (status IN ('draft','pending','confirmed','processing','shipped','delivered','completed','cancelled','refunded','on_hold','pending_fulfillment','awaiting_stock','pending_approval'));

ALTER TABLE contracts ADD CONSTRAINT chk_contracts_status
  CHECK (status IN ('draft','pending_approval','active','expired','terminated','under_review','suspended','cancelled','renewed','completed','pending_signature','amendment_pending'));

ALTER TABLE contracts ADD CONSTRAINT chk_contracts_contract_type
  CHECK (contract_type IN ('service','nda','sla','partnership','employment','vendor','non_compete','licensing','consulting','master_service','statement_of_work','amendment','end_user_license'));

-- ═══════════════════════════════════════════════════════════════════════════
-- AUTOMATION MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE workflows ADD CONSTRAINT chk_workflows_status
  CHECK (status IN ('draft','active','paused','archived'));

ALTER TABLE workflows ADD CONSTRAINT chk_workflows_trigger_type
  CHECK (trigger_type IN ('manual','schedule','event','webhook'));

ALTER TABLE workflow_executions ADD CONSTRAINT chk_workflow_executions_status
  CHECK (status IN ('running','completed','failed','cancelled'));

ALTER TABLE workflow_action_logs ADD CONSTRAINT chk_workflow_action_logs_status
  CHECK (status IN ('pending','running','success','failed','skipped'));

ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_status
  CHECK (status IN ('active','paused','error'));

ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_type
  CHECK (type IN ('pipeline','revenue','contacts','performance'));

ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_frequency
  CHECK (frequency IN ('hourly','daily','weekly','monthly'));

ALTER TABLE scheduled_reports ADD CONSTRAINT chk_scheduled_reports_format
  CHECK (format IN ('pdf','csv','xlsx'));

-- ═══════════════════════════════════════════════════════════════════════════
-- MARKETING MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sequences ADD CONSTRAINT chk_sequences_status
  CHECK (status IN ('draft','active','paused','archived'));

ALTER TABLE sequence_step_logs ADD CONSTRAINT chk_sequence_step_logs_status
  CHECK (status IN ('pending','sent','skipped','failed','cancelled'));

ALTER TABLE sequence_enrollments ADD CONSTRAINT chk_sequence_enrollments_status
  CHECK (status IN ('active','completed','paused','unsubscribed','error'));

ALTER TABLE sequence_steps ADD CONSTRAINT chk_sequence_steps_step_type
  CHECK (step_type IN ('email','delay','task','whatsapp'));

-- ═══════════════════════════════════════════════════════════════════════════
-- CORE / AUTH MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE approval_requests ADD CONSTRAINT chk_approval_requests_status
  CHECK (status IN ('pending','approved','rejected'));

ALTER TABLE field_permissions ADD CONSTRAINT chk_field_permissions_access_level
  CHECK (access_level IN ('none','read','write','admin'));

ALTER TABLE record_permissions ADD CONSTRAINT chk_record_permissions_access_level
  CHECK (access_level IN ('none','read','write','admin'));

ALTER TABLE notifications ADD CONSTRAINT chk_notifications_type
  CHECK (type IN ('info','mention','deal_stage','deal_won'));

ALTER TABLE team_members ADD CONSTRAINT chk_team_members_role
  CHECK (role IN ('manager','member'));

-- ═══════════════════════════════════════════════════════════════════════════
-- TERRITORIES MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE territories ADD CONSTRAINT chk_territories_type
  CHECK (type IN ('region','country','state','city','custom'));

ALTER TABLE territory_assignments ADD CONSTRAINT chk_territory_assignments_role
  CHECK (role IN ('owner','member'));

-- ═══════════════════════════════════════════════════════════════════════════
-- E-SIGNATURE MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE signing_requests ADD CONSTRAINT chk_signing_requests_status
  CHECK (status IN ('pending','sent','viewed','signed','declined','expired'));

ALTER TABLE signing_requests ADD CONSTRAINT chk_signing_requests_provider
  CHECK (provider IN ('docusign','hellosign','internal'));

ALTER TABLE signing_events ADD CONSTRAINT chk_signing_events_event
  CHECK (event IN ('sent','viewed','signed','declined'));

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPLIANCE MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE compliance_requests ADD CONSTRAINT chk_compliance_requests_type
  CHECK (type IN ('gdpr_export','gdpr_delete','soc2_report'));

ALTER TABLE compliance_requests ADD CONSTRAINT chk_compliance_requests_status
  CHECK (status IN ('pending','processing','completed','failed'));

ALTER TABLE data_retention_policies ADD CONSTRAINT chk_data_retention_policies_entity_type
  CHECK (entity_type IN ('contacts','deals','activities','emails','audit_logs'));

ALTER TABLE data_retention_policies ADD CONSTRAINT chk_data_retention_policies_action
  CHECK (action IN ('archive','delete','anonymize'));

-- ═══════════════════════════════════════════════════════════════════════════
-- INFRA MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE announcements ADD CONSTRAINT chk_announcements_type
  CHECK (type IN ('info','warning','update','feature'));

ALTER TABLE announcements ADD CONSTRAINT chk_announcements_target
  CHECK (target IN ('all','tenants','super_admins','plans','users'));

-- ═══════════════════════════════════════════════════════════════════════════
-- PLUGINS MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_status
  CHECK (status IN ('active','disabled','error'));

ALTER TABLE custom_plugins ADD CONSTRAINT chk_custom_plugins_auth_type
  CHECK (auth_type IN ('bearer','basic','api_key_header','api_key_query','oauth2_client_credentials','none'));

-- ═══════════════════════════════════════════════════════════════════════════
-- MODULES MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tenant_modules ADD CONSTRAINT chk_tenant_modules_status
  CHECK (status IN ('active','disabled'));

-- ═══════════════════════════════════════════════════════════════════════════
-- TEMPLATES MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE product_templates ADD CONSTRAINT chk_product_templates_status
  CHECK (status IN ('active','draft','archived'));

-- ═══════════════════════════════════════════════════════════════════════════
-- PROJECTS MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE projects ADD CONSTRAINT chk_projects_status
  CHECK (status IN ('active','on-hold','completed'));

-- ═══════════════════════════════════════════════════════════════════════════
-- CHAT MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE chat_sessions ADD CONSTRAINT chk_chat_sessions_status
  CHECK (status IN ('active','waiting','closed'));

ALTER TABLE chat_messages ADD CONSTRAINT chk_chat_messages_sender_type
  CHECK (sender_type IN ('visitor','agent','bot'));

-- ═══════════════════════════════════════════════════════════════════════════
-- SLA MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sla_policies ADD CONSTRAINT chk_sla_policies_priority
  CHECK (priority IN ('critical','high','medium','low'));

ALTER TABLE sla_breaches ADD CONSTRAINT chk_sla_breaches_entity_type
  CHECK (entity_type IN ('ticket','deal','task'));

ALTER TABLE sla_breaches ADD CONSTRAINT chk_sla_breaches_breach_type
  CHECK (breach_type IN ('response','resolution'));

-- ═══════════════════════════════════════════════════════════════════════════
-- ASSIGNMENT MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE assignment_rules ADD CONSTRAINT chk_assignment_rules_type
  CHECK (type IN ('round_robin','territory','skill_based','weighted'));

ALTER TABLE assignment_rules ADD CONSTRAINT chk_assignment_rules_entity_type
  CHECK (entity_type IN ('lead','ticket','deal'));

-- ═══════════════════════════════════════════════════════════════════════════
-- AI MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ai_activity ADD CONSTRAINT chk_ai_activity_status
  CHECK (status IN ('success','error','rate_limited','fallback_used'));

ALTER TABLE ai_activity ADD CONSTRAINT chk_ai_activity_action
  CHECK (action IN ('draft','lead_scoring','predict_deal','enrich_contact','suggest_followup','summarize'));

ALTER TABLE ai_draft_templates ADD CONSTRAINT chk_ai_draft_templates_kind
  CHECK (kind IN ('email','note','reply','call_prep'));

ALTER TABLE ai_provider_secrets ADD CONSTRAINT chk_ai_provider_secrets_key_type
  CHECK (key_type IN ('system','tenant','personal'));

ALTER TABLE tenant_ai_credits ADD CONSTRAINT chk_tenant_ai_credits_status
  CHECK (status IN ('active','exhausted','suspended'));

-- ═══════════════════════════════════════════════════════════════════════════
-- LEAD WARMING MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE lead_warming_events ADD CONSTRAINT chk_lead_warming_events_event_type
  CHECK (event_type IN ('festival','holiday','season','custom','birthday','anniversary'));

ALTER TABLE lead_warming_events ADD CONSTRAINT chk_lead_warming_events_recurrence
  CHECK (recurrence IN ('yearly','monthly','once','contact_specific'));

ALTER TABLE lead_warming_campaigns ADD CONSTRAINT chk_lead_warming_campaigns_status
  CHECK (status IN ('active','paused','draft','archived'));

ALTER TABLE lead_warming_messages ADD CONSTRAINT chk_lead_warming_messages_status
  CHECK (status IN ('pending','queued','sent','delivered','failed','bounced'));

ALTER TABLE lead_warming_messages ADD CONSTRAINT chk_lead_warming_messages_channel
  CHECK (channel IN ('email','whatsapp','sms'));

ALTER TABLE lead_warming_replies ADD CONSTRAINT chk_lead_warming_replies_intent
  CHECK (intent IN ('interested','not_interested','ask_later','question','complaint','out_of_office','unsubscribe','positive_social','unknown'));

ALTER TABLE lead_warming_replies ADD CONSTRAINT chk_lead_warming_replies_sentiment
  CHECK (sentiment IN ('positive','neutral','negative'));

-- ═══════════════════════════════════════════════════════════════════════════
-- COMM MODULE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE email_log ADD CONSTRAINT chk_email_log_status
  CHECK (status IN ('pending','sent','failed','bounced'));

ALTER TABLE integrations ADD CONSTRAINT chk_integrations_type
  CHECK (type IN ('google','outlook','zoom','slack'));

ALTER TABLE call_logs ADD CONSTRAINT chk_call_logs_direction
  CHECK (direction IN ('inbound','outbound'));

-- ═══════════════════════════════════════════════════════════════════════════
-- AMOUNT / PRICE COLUMNS (>= 0)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE deals ADD CONSTRAINT chk_deals_amount_nonneg CHECK (amount >= 0);
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_total_amount_nonneg CHECK (total_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_total_amount_nonneg CHECK (total_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_discount_amount_nonneg CHECK (discount_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_tax_amount_nonneg CHECK (tax_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_amount_paid_nonneg CHECK (amount_paid >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_amount_nonneg CHECK (total_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_discount_amount_nonneg CHECK (discount_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_tax_amount_nonneg CHECK (tax_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_amount_nonneg CHECK (shipping_amount >= 0);
ALTER TABLE invoice_line_items ADD CONSTRAINT chk_invoice_line_items_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE invoice_line_items ADD CONSTRAINT chk_invoice_line_items_discount_amount_nonneg CHECK (discount_amount >= 0);
ALTER TABLE invoice_line_items ADD CONSTRAINT chk_invoice_line_items_tax_amount_nonneg CHECK (tax_amount >= 0);
ALTER TABLE order_line_items ADD CONSTRAINT chk_order_line_items_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE quote_line_items ADD CONSTRAINT chk_quote_line_items_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE deal_products ADD CONSTRAINT chk_deal_products_price_nonneg CHECK (price >= 0);
ALTER TABLE lead_offers ADD CONSTRAINT chk_lead_offers_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE plans ADD CONSTRAINT chk_plans_price_nonneg CHECK (price >= 0);
ALTER TABLE plans ADD CONSTRAINT chk_plans_price_monthly_nonneg CHECK (price_monthly >= 0);
ALTER TABLE plans ADD CONSTRAINT chk_plans_price_yearly_nonneg CHECK (price_yearly >= 0);
ALTER TABLE products ADD CONSTRAINT chk_products_base_price_nonneg CHECK (base_price >= 0);
ALTER TABLE price_book_entries ADD CONSTRAINT chk_price_book_entries_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE services ADD CONSTRAINT chk_services_unit_price_nonneg CHECK (unit_price >= 0);
ALTER TABLE services ADD CONSTRAINT chk_services_monthly_price_nonneg CHECK (monthly_price >= 0);
ALTER TABLE services ADD CONSTRAINT chk_services_yearly_price_nonneg CHECK (yearly_price >= 0);
ALTER TABLE billing_events ADD CONSTRAINT chk_billing_events_amount_nonneg CHECK (amount >= 0);
ALTER TABLE invoice_payments ADD CONSTRAINT chk_invoice_payments_amount_nonneg CHECK (amount >= 0);
ALTER TABLE dunning_attempts ADD CONSTRAINT chk_dunning_attempts_payment_amount_nonneg CHECK (payment_amount >= 0);
ALTER TABLE service_subscriptions ADD CONSTRAINT chk_service_subscriptions_amount_nonneg CHECK (amount >= 0);
ALTER TABLE companies ADD CONSTRAINT chk_companies_annual_revenue_nonneg CHECK (annual_revenue >= 0);
ALTER TABLE services ADD CONSTRAINT chk_services_total_revenue_nonneg CHECK (total_revenue >= 0);
ALTER TABLE revenue_projections ADD CONSTRAINT chk_revenue_projections_projected_amount_nonneg CHECK (projected_amount >= 0);
ALTER TABLE revenue_projections ADD CONSTRAINT chk_revenue_projections_actual_amount_nonneg CHECK (actual_amount >= 0);
ALTER TABLE revenue_forecast_summary ADD CONSTRAINT chk_revenue_forecast_summary_total_expected_revenue_nonneg CHECK (total_expected_revenue >= 0);
ALTER TABLE ai_usage_logs ADD CONSTRAINT chk_ai_usage_logs_cost_cents_nonneg CHECK (cost_cents >= 0);
ALTER TABLE ai_activity ADD CONSTRAINT chk_ai_activity_cost_cents_nonneg CHECK (cost_cents >= 0);
ALTER TABLE ai_credits_ledger ADD CONSTRAINT chk_ai_credits_ledger_cost_cents_nonneg CHECK (cost_cents >= 0);
ALTER TABLE content_generations ADD CONSTRAINT chk_content_generations_cost_cents_nonneg CHECK (cost_cents >= 0);
ALTER TABLE voice_calls ADD CONSTRAINT chk_voice_calls_cost_cents_nonneg CHECK (cost_cents >= 0);
ALTER TABLE tenant_ai_credits ADD CONSTRAINT chk_tenant_ai_credits_allocated_cost_cents_nonneg CHECK (allocated_cost_cents >= 0);
ALTER TABLE tenant_ai_credits ADD CONSTRAINT chk_tenant_ai_credits_used_cost_cents_nonneg CHECK (used_cost_cents >= 0);

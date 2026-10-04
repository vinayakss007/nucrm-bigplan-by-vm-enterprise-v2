/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2259 (down): restore the constraint landscape that
-- 0113_dedupe_foreign_keys.sql collapsed — reverse the 10 renames, then
-- re-add the 78 dropped constraints with their original names and ON DELETE
-- semantics. Existing rows already satisfy every FK (the columns were already
-- constrained by the kept twin), so validation is cheap; each ADD is guarded
-- so the file is rerunnable.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_tenant_id_tenants_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_tenant_id_fkey')
  THEN
    ALTER TABLE order_line_items RENAME CONSTRAINT order_line_items_tenant_id_tenants_id_fk TO order_line_items_tenant_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_order_id_orders_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_order_id_fkey')
  THEN
    ALTER TABLE order_line_items RENAME CONSTRAINT order_line_items_order_id_orders_id_fk TO order_line_items_order_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_tenant_id_tenants_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_tenant_id_fkey')
  THEN
    ALTER TABLE invoice_payments RENAME CONSTRAINT invoice_payments_tenant_id_tenants_id_fk TO invoice_payments_tenant_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_invoice_id_invoices_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_invoice_id_fkey')
  THEN
    ALTER TABLE invoice_payments RENAME CONSTRAINT invoice_payments_invoice_id_invoices_id_fk TO invoice_payments_invoice_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_tenant_id_tenants_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_tenant_id_fkey')
  THEN
    ALTER TABLE invoice_line_items RENAME CONSTRAINT invoice_line_items_tenant_id_tenants_id_fk TO invoice_line_items_tenant_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_invoice_id_invoices_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_invoice_id_fkey')
  THEN
    ALTER TABLE invoice_line_items RENAME CONSTRAINT invoice_line_items_invoice_id_invoices_id_fk TO invoice_line_items_invoice_id_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_deleted_by_users_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_deleted_by_fkey')
  THEN
    ALTER TABLE tenant_ai_credentials RENAME CONSTRAINT tenant_ai_credentials_deleted_by_users_id_fk TO tenant_ai_credentials_deleted_by_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_updated_by_users_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_updated_by_fkey')
  THEN
    ALTER TABLE tenant_ai_credentials RENAME CONSTRAINT tenant_ai_credentials_updated_by_users_id_fk TO tenant_ai_credentials_updated_by_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_deleted_by_users_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_deleted_by_fkey')
  THEN
    ALTER TABLE ai_providers RENAME CONSTRAINT ai_providers_deleted_by_users_id_fk TO ai_providers_deleted_by_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_updated_by_users_id_fk')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_updated_by_fkey')
  THEN
    ALTER TABLE ai_providers RENAME CONSTRAINT ai_providers_updated_by_users_id_fk TO ai_providers_updated_by_fkey;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'companies'::regclass AND conname = 'fk_companies_updated_by') THEN
    ALTER TABLE companies ADD CONSTRAINT fk_companies_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'companies'::regclass AND conname = 'fk_companies_deleted_by') THEN
    ALTER TABLE companies ADD CONSTRAINT fk_companies_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'contacts'::regclass AND conname = 'fk_contacts_updated_by') THEN
    ALTER TABLE contacts ADD CONSTRAINT fk_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'contacts'::regclass AND conname = 'fk_contacts_deleted_by') THEN
    ALTER TABLE contacts ADD CONSTRAINT fk_contacts_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'deals'::regclass AND conname = 'fk_deals_updated_by') THEN
    ALTER TABLE deals ADD CONSTRAINT fk_deals_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'deals'::regclass AND conname = 'fk_deals_deleted_by') THEN
    ALTER TABLE deals ADD CONSTRAINT fk_deals_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'forms'::regclass AND conname = 'fk_forms_updated_by') THEN
    ALTER TABLE forms ADD CONSTRAINT fk_forms_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'forms'::regclass AND conname = 'fk_forms_deleted_by') THEN
    ALTER TABLE forms ADD CONSTRAINT fk_forms_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lead_scoring_rules'::regclass AND conname = 'fk_lead_scoring_rules_updated_by') THEN
    ALTER TABLE lead_scoring_rules ADD CONSTRAINT fk_lead_scoring_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lead_scoring_rules'::regclass AND conname = 'fk_lead_scoring_rules_deleted_by') THEN
    ALTER TABLE lead_scoring_rules ADD CONSTRAINT fk_lead_scoring_rules_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'leads'::regclass AND conname = 'fk_leads_updated_by') THEN
    ALTER TABLE leads ADD CONSTRAINT fk_leads_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'leads'::regclass AND conname = 'fk_leads_deleted_by') THEN
    ALTER TABLE leads ADD CONSTRAINT fk_leads_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'meetings'::regclass AND conname = 'fk_meetings_updated_by') THEN
    ALTER TABLE meetings ADD CONSTRAINT fk_meetings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'meetings'::regclass AND conname = 'fk_meetings_deleted_by') THEN
    ALTER TABLE meetings ADD CONSTRAINT fk_meetings_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notes'::regclass AND conname = 'fk_notes_updated_by') THEN
    ALTER TABLE notes ADD CONSTRAINT fk_notes_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notes'::regclass AND conname = 'fk_notes_deleted_by') THEN
    ALTER TABLE notes ADD CONSTRAINT fk_notes_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_books'::regclass AND conname = 'fk_price_books_updated_by') THEN
    ALTER TABLE price_books ADD CONSTRAINT fk_price_books_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_books'::regclass AND conname = 'fk_price_books_deleted_by') THEN
    ALTER TABLE price_books ADD CONSTRAINT fk_price_books_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'fk_products_updated_by') THEN
    ALTER TABLE products ADD CONSTRAINT fk_products_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'fk_products_deleted_by') THEN
    ALTER TABLE products ADD CONSTRAINT fk_products_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'quotes'::regclass AND conname = 'fk_quotes_updated_by') THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'quotes'::regclass AND conname = 'fk_quotes_deleted_by') THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_email_drafts'::regclass AND conname = 'fk_ai_email_drafts_updated_by') THEN
    ALTER TABLE ai_email_drafts ADD CONSTRAINT fk_ai_email_drafts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_email_drafts'::regclass AND conname = 'fk_ai_email_drafts_deleted_by') THEN
    ALTER TABLE ai_email_drafts ADD CONSTRAINT fk_ai_email_drafts_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'automation_workflows'::regclass AND conname = 'fk_automation_workflows_updated_by') THEN
    ALTER TABLE automation_workflows ADD CONSTRAINT fk_automation_workflows_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'automation_workflows'::regclass AND conname = 'fk_automation_workflows_deleted_by') THEN
    ALTER TABLE automation_workflows ADD CONSTRAINT fk_automation_workflows_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'automations'::regclass AND conname = 'fk_automations_updated_by') THEN
    ALTER TABLE automations ADD CONSTRAINT fk_automations_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'automations'::regclass AND conname = 'fk_automations_deleted_by') THEN
    ALTER TABLE automations ADD CONSTRAINT fk_automations_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workflows'::regclass AND conname = 'fk_workflows_updated_by') THEN
    ALTER TABLE workflows ADD CONSTRAINT fk_workflows_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workflows'::regclass AND conname = 'fk_workflows_deleted_by') THEN
    ALTER TABLE workflows ADD CONSTRAINT fk_workflows_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'announcements'::regclass AND conname = 'fk_announcements_updated_by') THEN
    ALTER TABLE announcements ADD CONSTRAINT fk_announcements_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'announcements'::regclass AND conname = 'fk_announcements_deleted_by') THEN
    ALTER TABLE announcements ADD CONSTRAINT fk_announcements_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'backup_records'::regclass AND conname = 'fk_backup_records_updated_by') THEN
    ALTER TABLE backup_records ADD CONSTRAINT fk_backup_records_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'backup_records'::regclass AND conname = 'fk_backup_records_deleted_by') THEN
    ALTER TABLE backup_records ADD CONSTRAINT fk_backup_records_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'critical_data_backups'::regclass AND conname = 'fk_critical_data_backups_updated_by') THEN
    ALTER TABLE critical_data_backups ADD CONSTRAINT fk_critical_data_backups_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'critical_data_backups'::regclass AND conname = 'fk_critical_data_backups_deleted_by') THEN
    ALTER TABLE critical_data_backups ADD CONSTRAINT fk_critical_data_backups_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dashboards'::regclass AND conname = 'fk_dashboards_updated_by') THEN
    ALTER TABLE dashboards ADD CONSTRAINT fk_dashboards_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dashboards'::regclass AND conname = 'fk_dashboards_deleted_by') THEN
    ALTER TABLE dashboards ADD CONSTRAINT fk_dashboards_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'saved_reports'::regclass AND conname = 'fk_saved_reports_updated_by') THEN
    ALTER TABLE saved_reports ADD CONSTRAINT fk_saved_reports_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'saved_reports'::regclass AND conname = 'fk_saved_reports_deleted_by') THEN
    ALTER TABLE saved_reports ADD CONSTRAINT fk_saved_reports_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'fk_tasks_updated_by') THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'fk_tasks_deleted_by') THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_departures'::regclass AND conname = 'fk_user_departures_updated_by') THEN
    ALTER TABLE user_departures ADD CONSTRAINT fk_user_departures_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_departures'::regclass AND conname = 'fk_user_departures_deleted_by') THEN
    ALTER TABLE user_departures ADD CONSTRAINT fk_user_departures_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'support_tickets'::regclass AND conname = 'fk_support_tickets_updated_by') THEN
    ALTER TABLE support_tickets ADD CONSTRAINT fk_support_tickets_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'support_tickets'::regclass AND conname = 'fk_support_tickets_deleted_by') THEN
    ALTER TABLE support_tickets ADD CONSTRAINT fk_support_tickets_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sequences'::regclass AND conname = 'fk_sequences_updated_by') THEN
    ALTER TABLE sequences ADD CONSTRAINT fk_sequences_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sequences'::regclass AND conname = 'fk_sequences_deleted_by') THEN
    ALTER TABLE sequences ADD CONSTRAINT fk_sequences_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'segments'::regclass AND conname = 'fk_segments_updated_by') THEN
    ALTER TABLE segments ADD CONSTRAINT fk_segments_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'segments'::regclass AND conname = 'fk_segments_deleted_by') THEN
    ALTER TABLE segments ADD CONSTRAINT fk_segments_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_draft_templates'::regclass AND conname = 'fk_ai_draft_templates_updated_by') THEN
    ALTER TABLE ai_draft_templates ADD CONSTRAINT fk_ai_draft_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'at_risk_rules'::regclass AND conname = 'fk_at_risk_rules_updated_by') THEN
    ALTER TABLE at_risk_rules ADD CONSTRAINT fk_at_risk_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND conname = 'fk_contracts_updated_by') THEN
    ALTER TABLE contracts ADD CONSTRAINT fk_contracts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND conname = 'fk_contracts_deleted_by') THEN
    ALTER TABLE contracts ADD CONSTRAINT fk_contracts_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'fk_invoice_payments_updated_by') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT fk_invoice_payments_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'fk_invoice_payments_deleted_by') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT fk_invoice_payments_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND conname = 'fk_invoices_updated_by') THEN
    ALTER TABLE invoices ADD CONSTRAINT fk_invoices_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND conname = 'fk_invoices_deleted_by') THEN
    ALTER TABLE invoices ADD CONSTRAINT fk_invoices_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'fk_orders_updated_by') THEN
    ALTER TABLE orders ADD CONSTRAINT fk_orders_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'fk_orders_deleted_by') THEN
    ALTER TABLE orders ADD CONSTRAINT fk_orders_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'service_categories'::regclass AND conname = 'fk_service_categories_updated_by') THEN
    ALTER TABLE service_categories ADD CONSTRAINT fk_service_categories_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'service_categories'::regclass AND conname = 'fk_service_categories_deleted_by') THEN
    ALTER TABLE service_categories ADD CONSTRAINT fk_service_categories_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'services'::regclass AND conname = 'fk_services_updated_by') THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'services'::regclass AND conname = 'fk_services_deleted_by') THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'fk_ai_providers_updated_by') THEN
    ALTER TABLE ai_providers ADD CONSTRAINT fk_ai_providers_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'fk_ai_providers_deleted_by') THEN
    ALTER TABLE ai_providers ADD CONSTRAINT fk_ai_providers_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'fk_tenant_ai_credentials_updated_by') THEN
    ALTER TABLE tenant_ai_credentials ADD CONSTRAINT fk_tenant_ai_credentials_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'fk_tenant_ai_credentials_deleted_by') THEN
    ALTER TABLE tenant_ai_credentials ADD CONSTRAINT fk_tenant_ai_credentials_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'fk_invoice_line_items_invoice') THEN
    ALTER TABLE invoice_line_items ADD CONSTRAINT fk_invoice_line_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'fk_invoice_line_items_tenant') THEN
    ALTER TABLE invoice_line_items ADD CONSTRAINT fk_invoice_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE NO ACTION;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'fk_invoice_payments_invoice') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT fk_invoice_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'fk_invoice_payments_recorded_by') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT fk_invoice_payments_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'fk_invoice_payments_tenant') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT fk_invoice_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE NO ACTION;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'fk_order_line_items_order') THEN
    ALTER TABLE order_line_items ADD CONSTRAINT fk_order_line_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'fk_order_line_items_tenant') THEN
    ALTER TABLE order_line_items ADD CONSTRAINT fk_order_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE NO ACTION;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dunning_attempts'::regclass AND conname = 'dunning_attempts_subscription_id_fk') THEN
    ALTER TABLE dunning_attempts ADD CONSTRAINT dunning_attempts_subscription_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE NO ACTION;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'leads'::regclass AND conname = 'leads_requested_service_id_fkey') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_requested_service_id_fkey FOREIGN KEY (requested_service_id) REFERENCES services (id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'leads'::regclass AND conname = 'leads_team_id_fkey') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL;
  END IF;
END $$;

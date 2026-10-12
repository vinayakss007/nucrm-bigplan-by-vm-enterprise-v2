/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2259 — dedupe 78 duplicate foreign-key pairs and align the survivors with
-- the constraint names/semantics drizzle/schema declares.
--
-- Root cause: the same (table, column -> referenced table, column) relationship
-- was declared twice over the years — once by drizzle-managed DDL (names ending
-- in _fk / legacy push names ending in _fkey) and once by hand-written
-- migrations (fk_<table>_<col>, e.g. 0030_add_fk_constraints_billing_documents).
-- Postgres enforces EVERY FK on a column, so in 4 groups the stricter
-- NO ACTION survivor defeated the declared CASCADE and tenant purges died on
-- FK violations: invoice_line_items.tenant_id, invoice_payments.tenant_id,
-- order_line_items.tenant_id (all -> tenants, intended ON DELETE CASCADE via
-- utils.tenantId()) and dunning_attempts.subscription_id (-> subscriptions,
-- intended CASCADE per drizzle/schema/billing.ts).
--
-- For each duplicate group this migration keeps exactly one constraint —
-- preferentially the one named the way drizzle-kit generates
-- (<table>_<col>_<reftable>_<refcol>_fk>) and whose confdeltype matches the
-- ON DELETE semantics declared in drizzle/schema — and drops the redundant
-- sibling. Where the surviving constraint predates the rename convention
-- (Postgres-default *_fkey names), it is RENAMEd to the expected name
-- (metadata-only, no scan) so a future drizzle-kit push/generate cannot
-- re-add a second FK on the same column and regrow the duplicate. No group
-- needed a drop-and-recreate: in every case the kept constraint already
-- carries the intended confdeltype, so the ADD ... NOT VALID / VALIDATE
-- low-lock pattern was never triggered.
--
-- Idempotent and rerunnable (live deploys do not run migrations — #2233/#2144 —
-- so a half-applied state is normal): every DROP is IF EXISTS and every RENAME
-- is guarded by an EXISTS(old) AND NOT EXISTS(new) check.

-- ── 1. Drop the 78 redundant constraints (one per duplicate group) ──
ALTER TABLE companies DROP CONSTRAINT IF EXISTS fk_companies_updated_by;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS fk_companies_deleted_by;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS fk_contacts_updated_by;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS fk_contacts_deleted_by;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS fk_deals_updated_by;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS fk_deals_deleted_by;
ALTER TABLE forms DROP CONSTRAINT IF EXISTS fk_forms_updated_by;
ALTER TABLE forms DROP CONSTRAINT IF EXISTS fk_forms_deleted_by;
ALTER TABLE lead_scoring_rules DROP CONSTRAINT IF EXISTS fk_lead_scoring_rules_updated_by;
ALTER TABLE lead_scoring_rules DROP CONSTRAINT IF EXISTS fk_lead_scoring_rules_deleted_by;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS fk_leads_updated_by;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS fk_leads_deleted_by;
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS fk_meetings_updated_by;
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS fk_meetings_deleted_by;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS fk_notes_updated_by;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS fk_notes_deleted_by;
ALTER TABLE price_books DROP CONSTRAINT IF EXISTS fk_price_books_updated_by;
ALTER TABLE price_books DROP CONSTRAINT IF EXISTS fk_price_books_deleted_by;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_updated_by;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_deleted_by;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS fk_quotes_updated_by;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS fk_quotes_deleted_by;
ALTER TABLE ai_email_drafts DROP CONSTRAINT IF EXISTS fk_ai_email_drafts_updated_by;
ALTER TABLE ai_email_drafts DROP CONSTRAINT IF EXISTS fk_ai_email_drafts_deleted_by;
ALTER TABLE automation_workflows DROP CONSTRAINT IF EXISTS fk_automation_workflows_updated_by;
ALTER TABLE automation_workflows DROP CONSTRAINT IF EXISTS fk_automation_workflows_deleted_by;
ALTER TABLE automations DROP CONSTRAINT IF EXISTS fk_automations_updated_by;
ALTER TABLE automations DROP CONSTRAINT IF EXISTS fk_automations_deleted_by;
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS fk_workflows_updated_by;
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS fk_workflows_deleted_by;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS fk_announcements_updated_by;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS fk_announcements_deleted_by;
ALTER TABLE backup_records DROP CONSTRAINT IF EXISTS fk_backup_records_updated_by;
ALTER TABLE backup_records DROP CONSTRAINT IF EXISTS fk_backup_records_deleted_by;
ALTER TABLE critical_data_backups DROP CONSTRAINT IF EXISTS fk_critical_data_backups_updated_by;
ALTER TABLE critical_data_backups DROP CONSTRAINT IF EXISTS fk_critical_data_backups_deleted_by;
ALTER TABLE dashboards DROP CONSTRAINT IF EXISTS fk_dashboards_updated_by;
ALTER TABLE dashboards DROP CONSTRAINT IF EXISTS fk_dashboards_deleted_by;
ALTER TABLE saved_reports DROP CONSTRAINT IF EXISTS fk_saved_reports_updated_by;
ALTER TABLE saved_reports DROP CONSTRAINT IF EXISTS fk_saved_reports_deleted_by;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_updated_by;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_deleted_by;
ALTER TABLE user_departures DROP CONSTRAINT IF EXISTS fk_user_departures_updated_by;
ALTER TABLE user_departures DROP CONSTRAINT IF EXISTS fk_user_departures_deleted_by;
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS fk_support_tickets_updated_by;
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS fk_support_tickets_deleted_by;
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS fk_sequences_updated_by;
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS fk_sequences_deleted_by;
ALTER TABLE segments DROP CONSTRAINT IF EXISTS fk_segments_updated_by;
ALTER TABLE segments DROP CONSTRAINT IF EXISTS fk_segments_deleted_by;
ALTER TABLE ai_draft_templates DROP CONSTRAINT IF EXISTS fk_ai_draft_templates_updated_by;
ALTER TABLE at_risk_rules DROP CONSTRAINT IF EXISTS fk_at_risk_rules_updated_by;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_updated_by;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_deleted_by;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_updated_by;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_deleted_by;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS fk_invoices_updated_by;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS fk_invoices_deleted_by;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_updated_by;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_deleted_by;
ALTER TABLE service_categories DROP CONSTRAINT IF EXISTS fk_service_categories_updated_by;
ALTER TABLE service_categories DROP CONSTRAINT IF EXISTS fk_service_categories_deleted_by;
ALTER TABLE services DROP CONSTRAINT IF EXISTS fk_services_updated_by;
ALTER TABLE services DROP CONSTRAINT IF EXISTS fk_services_deleted_by;
ALTER TABLE ai_providers DROP CONSTRAINT IF EXISTS fk_ai_providers_updated_by;
ALTER TABLE ai_providers DROP CONSTRAINT IF EXISTS fk_ai_providers_deleted_by;
ALTER TABLE tenant_ai_credentials DROP CONSTRAINT IF EXISTS fk_tenant_ai_credentials_updated_by;
ALTER TABLE tenant_ai_credentials DROP CONSTRAINT IF EXISTS fk_tenant_ai_credentials_deleted_by;
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS fk_invoice_line_items_invoice;
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS fk_invoice_line_items_tenant;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_invoice;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_recorded_by;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS fk_invoice_payments_tenant;
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS fk_order_line_items_order;
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS fk_order_line_items_tenant;
ALTER TABLE dunning_attempts DROP CONSTRAINT IF EXISTS dunning_attempts_subscription_id_fk;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_requested_service_id_fkey;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_team_id_fkey;

-- ── 2. Rename 10 survivors to the names drizzle/schema expects ──
-- (metadata-only; guarded so a rerun is a no-op)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_updated_by_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_updated_by_users_id_fk')
  THEN
    ALTER TABLE ai_providers RENAME CONSTRAINT ai_providers_updated_by_fkey TO ai_providers_updated_by_users_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_deleted_by_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND conname = 'ai_providers_deleted_by_users_id_fk')
  THEN
    ALTER TABLE ai_providers RENAME CONSTRAINT ai_providers_deleted_by_fkey TO ai_providers_deleted_by_users_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_updated_by_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_updated_by_users_id_fk')
  THEN
    ALTER TABLE tenant_ai_credentials RENAME CONSTRAINT tenant_ai_credentials_updated_by_fkey TO tenant_ai_credentials_updated_by_users_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_deleted_by_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenant_ai_credentials'::regclass AND conname = 'tenant_ai_credentials_deleted_by_users_id_fk')
  THEN
    ALTER TABLE tenant_ai_credentials RENAME CONSTRAINT tenant_ai_credentials_deleted_by_fkey TO tenant_ai_credentials_deleted_by_users_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_invoice_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_invoice_id_invoices_id_fk')
  THEN
    ALTER TABLE invoice_line_items RENAME CONSTRAINT invoice_line_items_invoice_id_fkey TO invoice_line_items_invoice_id_invoices_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_tenant_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_line_items'::regclass AND conname = 'invoice_line_items_tenant_id_tenants_id_fk')
  THEN
    ALTER TABLE invoice_line_items RENAME CONSTRAINT invoice_line_items_tenant_id_fkey TO invoice_line_items_tenant_id_tenants_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_invoice_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_invoice_id_invoices_id_fk')
  THEN
    ALTER TABLE invoice_payments RENAME CONSTRAINT invoice_payments_invoice_id_fkey TO invoice_payments_invoice_id_invoices_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_tenant_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoice_payments'::regclass AND conname = 'invoice_payments_tenant_id_tenants_id_fk')
  THEN
    ALTER TABLE invoice_payments RENAME CONSTRAINT invoice_payments_tenant_id_fkey TO invoice_payments_tenant_id_tenants_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_order_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_order_id_orders_id_fk')
  THEN
    ALTER TABLE order_line_items RENAME CONSTRAINT order_line_items_order_id_fkey TO order_line_items_order_id_orders_id_fk;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_tenant_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_line_items'::regclass AND conname = 'order_line_items_tenant_id_tenants_id_fk')
  THEN
    ALTER TABLE order_line_items RENAME CONSTRAINT order_line_items_tenant_id_fkey TO order_line_items_tenant_id_tenants_id_fk;
  END IF;
END $$;

-- ── 3. Post-condition sanity check ──
-- After this migration the duplicate-group count measured with
--   SELECT count(*) FROM (SELECT conrelid, confrelid, conkey, confkey
--     FROM pg_constraint WHERE contype='f' GROUP BY 1,2,3,4 HAVING count(*)>1) x;
-- must be 0. RAISE EXCEPTION below turns a silent partial apply into a failed
-- migration instead.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT conrelid, confrelid, conkey, confkey FROM pg_constraint
    WHERE contype='f' AND connamespace = 'public'::regnamespace
    GROUP BY 1,2,3,4 HAVING count(*) > 1) x;
  IF n > 0 THEN
    RAISE EXCEPTION '#2259: % duplicate FK group(s) remain after dedupe', n;
  END IF;
END $$;


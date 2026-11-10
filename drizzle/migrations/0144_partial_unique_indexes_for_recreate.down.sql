/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- Rollback for 0144 (#3406): drop each "<old>_live" partial index and rebuild the
-- tombstone-inclusive surface under its original name. Name-for-name, in the reverse
-- order of the apply: the partial index goes first so the original can take the name
-- back, and because rebuilding it is the statement that can fail — a live duplicate
-- created under 0144 is a data decision, see the caveat in the up file's header.
-- BEGIN/COMMIT deliberately absent: the drops are CONCURRENTLY and cannot sit in a
-- transaction block.

-- automation_workflows: back to idx_automation_workflows_tenant_workflow
DROP INDEX CONCURRENTLY IF EXISTS "idx_automation_workflows_tenant_workflow_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_workflows_tenant_workflow" ON "public"."automation_workflows" ("tenant_id", "workflow_id");

-- contact_emails: back to idx_contact_emails_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_contact_emails_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_contact_emails_unique" ON "public"."contact_emails" ("contact_id", "email");

-- custom_field_defs: back to idx_custom_fields_unique_key
DROP INDEX CONCURRENTLY IF EXISTS "idx_custom_fields_unique_key_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_custom_fields_unique_key" ON "public"."custom_field_defs" ("tenant_id", "entity_type", "field_key");

-- dashboard_templates: back to dashboard_templates_slug_unique
DROP INDEX CONCURRENTLY IF EXISTS "dashboard_templates_slug_unique_live";
ALTER TABLE ONLY "dashboard_templates" ADD CONSTRAINT "dashboard_templates_slug_unique" UNIQUE ("slug");

-- email_warmup_configs: back to idx_email_warmup_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_email_warmup_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_email_warmup_unique" ON "public"."email_warmup_configs" ("tenant_id", "from_email");

-- field_permissions: back to idx_field_permissions_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_field_permissions_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_field_permissions_unique" ON "public"."field_permissions" ("tenant_id", "role_id", "entity_type", "field_name");

-- forms: back to the constraint forms_slug_unique, which is all the pre-0144 database
-- had. `idx_forms_slug` is NOT rebuilt: 0116 (#2264) dropped it as an exact duplicate
-- of that constraint, `drizzle/schema/crm.ts` never declared it, and a rollback that
-- resurrects a dropped duplicate would hand #2264 back its bug.
DROP INDEX CONCURRENTLY IF EXISTS "idx_forms_slug_live";
ALTER TABLE ONLY "forms" ADD CONSTRAINT "forms_slug_unique" UNIQUE ("slug");

-- invitations: back to idx_invitations_tenant_email
DROP INDEX CONCURRENTLY IF EXISTS "idx_invitations_tenant_email_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_tenant_email" ON "public"."invitations" ("tenant_id", "email");

-- invoices: back to idx_invoices_number
DROP INDEX CONCURRENTLY IF EXISTS "idx_invoices_number_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_number" ON "public"."invoices" ("tenant_id", "invoice_number");

-- lead_warming_schedule: back to idx_lead_warming_sched_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_lead_warming_sched_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_lead_warming_sched_unique" ON "public"."lead_warming_schedule" ("contact_id", "campaign_id");

-- onboarding_progress: back to idx_onboarding_progress_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_onboarding_progress_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_progress_unique" ON "public"."onboarding_progress" ("tenant_id", "user_id", "step_name");

-- orders: back to idx_orders_number
DROP INDEX CONCURRENTLY IF EXISTS "idx_orders_number_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_number" ON "public"."orders" ("tenant_id", "order_number");

-- pipeline_health_metrics: back to idx_pipeline_health_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_pipeline_health_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pipeline_health_unique" ON "public"."pipeline_health_metrics" ("pipeline_id", "metric_date");

-- price_book_entries: back to idx_price_book_entries_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_price_book_entries_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_price_book_entries_unique" ON "public"."price_book_entries" ("price_book_id", "product_id");

-- product_templates: back to product_templates_slug_unique
DROP INDEX CONCURRENTLY IF EXISTS "product_templates_slug_unique_live";
ALTER TABLE ONLY "product_templates" ADD CONSTRAINT "product_templates_slug_unique" UNIQUE ("slug");

-- record_links: back to idx_record_links_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_record_links_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_record_links_unique" ON "public"."record_links" ("tenant_id", "from_type", "from_id", "to_type", "to_id", "relation");

-- report_templates: back to report_templates_slug_unique
DROP INDEX CONCURRENTLY IF EXISTS "report_templates_slug_unique_live";
ALTER TABLE ONLY "report_templates" ADD CONSTRAINT "report_templates_slug_unique" UNIQUE ("slug");

-- roles: back to idx_roles_tenant_slug
DROP INDEX CONCURRENTLY IF EXISTS "idx_roles_tenant_slug_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_roles_tenant_slug" ON "public"."roles" ("tenant_id", "slug");

-- team_members: back to idx_team_members_team_user
DROP INDEX CONCURRENTLY IF EXISTS "idx_team_members_team_user_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_team_members_team_user" ON "public"."team_members" ("team_id", "user_id");

-- teams: back to idx_teams_tenant_name
DROP INDEX CONCURRENTLY IF EXISTS "idx_teams_tenant_name_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_teams_tenant_name" ON "public"."teams" ("tenant_id", "name");

-- tenant_members: back to idx_tenant_members_tenant_user
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_members_tenant_user_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_members_tenant_user" ON "public"."tenant_members" ("tenant_id", "user_id");

-- tenant_modules: back to idx_tenant_modules_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_modules_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_modules_unique" ON "public"."tenant_modules" ("tenant_id", "module_id");

-- tenant_templates: back to idx_tenant_templates_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_templates_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_templates_unique" ON "public"."tenant_templates" ("tenant_id", "template_id");

-- tenants: back to idx_tenants_short_code
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenants_short_code_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenants_short_code" ON "public"."tenants" ("short_code") WHERE short_code IS NOT NULL;

-- tenants: back to tenants_custom_domain_unique
DROP INDEX CONCURRENTLY IF EXISTS "tenants_custom_domain_unique_live";
ALTER TABLE ONLY "tenants" ADD CONSTRAINT "tenants_custom_domain_unique" UNIQUE ("custom_domain");

-- tenants: back to tenants_slug_unique
DROP INDEX CONCURRENTLY IF EXISTS "tenants_slug_unique_live";
ALTER TABLE ONLY "tenants" ADD CONSTRAINT "tenants_slug_unique" UNIQUE ("slug");

-- webhook_field_mappings: back to idx_webhook_field_mappings_unique
DROP INDEX CONCURRENTLY IF EXISTS "idx_webhook_field_mappings_unique_live";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_field_mappings_unique" ON "public"."webhook_field_mappings" ("tenant_id", "api_key_id", "entity_type", "source_key");

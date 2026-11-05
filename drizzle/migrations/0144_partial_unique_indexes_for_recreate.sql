/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0144: a deleted row stops keeping its key reserved (#3406, PR-3C).
--
-- Soft delete is a convention, not an invariant. 204 of the 226 tables in the
-- #2255 inventory carry `deleted_at` (measured by
-- scripts/check-partial-unique-indexes.mts over the corpus), and uniqueness was
-- written as if it did not: 59 unique surfaces sit on soft-deletable tables and
-- 7 of them excluded tombstones. The other 52 decided what "taken" means one
-- call site at a time.
--
-- The user-visible bug is the delete-then-retype round trip. `teams` is the clean
-- instance: `idx_teams_tenant_name` is unique on (tenant_id, name) with no WHERE,
-- so trash the team "Sales", type "Sales" again, and the insert dies with 23505 —
-- "that name is already in use" for a name the UI will not show you anywhere,
-- because every list query filters `deletedAt IS NULL`. Same shape, same table
-- family: remove a member from a team and re-add them (`idx_team_members_team_user`),
-- delete a custom field and re-create it with the same key
-- (`idx_custom_fields_unique_key`), resend an invitation to the same address after
-- deleting the old one (`idx_invitations_tenant_email`), void an invoice and re-issue
-- the number it held (`idx_invoices_number`).
--
-- Each of those has an inverse failure the tombstone-blind index was also hiding:
-- restore. `custom_entities`, `ai_draft_templates` and `invoices.quote_id` already
-- index live rows only, so two rows can hold one key while one of them is dead, and
-- the collision surfaces as a 23505 *at restore time* rather than at create time.
-- That is the correct direction — the audit asks for restore to fail loudly — and it
-- is what this file makes uniform: uniqueness now means "unique among live rows",
-- which is what the 614 `deletedAt IS NULL` / `isNull(...deletedAt)` predicates in
-- app/ and lib/ already assume.
--
-- WHAT IS NOT CHANGED, AND WHY
-- ----------------------------
-- Of the 52, this file converts 27 — every one a business key a person deletes and
-- then retypes (a team name, an invoice number, a role slug, a membership pair) —
-- and leaves 25 with absolute uniqueness. Those 25 are not oversights: each carries a
-- reason in scripts/partial-unique-absolute.json, and the screen re-verifies every one
-- of those reasons per run, so an exemption cannot outlive its code. They are the
-- interesting ones:
--   - one-time tokens and credential hashes (password_resets.token,
--     refresh_tokens.token, invitations.token, api_keys.key_hash,
--     support_tickets.portal_token, email_verifications.token_hash): the entire value
--     of the unique index is that a presented secret resolves to exactly one row,
--     tombstones included. Partiality would let a revoked token be re-issued while its
--     dead twin still authenticates.
--   - provider event ids (billing_events.stripe_event_id, uq_whatsapp_msg_tenant_external):
--     webhook idempotency. A vendor re-delivers an event it already delivered; if the
--     dedupe arm ignores tombstones, the redelivery is booked a second time.
--   - per-entity aggregates and singletons (idx_user_usage_unique,
--     idx_token_budgets_service_period, system_settings.key, plan_limits.plan_id, ...):
--     those rows are upserted, never trashed, and partiality lets a deleted aggregate
--     and a live one describe the same period.
--   - users.email, deliberately: making it partial means every login and lookup path
--     must filter `deleted_at` first, and that audit is its own change. Noted as a
--     follow-up rather than smuggled in here.
--
-- SHAPE OF EACH CHANGE
-- --------------------
-- Every surface becomes two statements, in this order and never the other:
--
--   CREATE UNIQUE INDEX CONCURRENTLY "<old>_live" ... WHERE deleted_at IS NULL;
--   DROP INDEX CONCURRENTLY "<old>"  /  ALTER TABLE ... DROP CONSTRAINT "<old>";
--
-- Build-then-drop, because drop-then-build leaves a window with no uniqueness at all
-- on tables where inserts are concurrent (invoices, tenant_members, record_links), and
-- a duplicate that slips through that window then blocks the rebuild outright — the
-- migration would fail half-applied. CONCURRENTLY throughout, because a plain build
-- takes SHARE on the table and blocks every write to it for the duration, which is what
-- scripts/migration-index-ddl.mjs and `guard:chain` now refuse in a new file (#3301).
-- scripts/migrate.ts detects CONCURRENTLY in a pending file and routes the whole apply
-- through its online-incremental path, autocommitting those statements outside any
-- transaction, which is the only way they can run at all.
--
-- The new name is `<old>_live`, kept next to the old one rather than reusing it, so the
-- rollback in 0144_partial_unique_indexes_for_recreate.down.sql is a name-for-name swap
-- and `pg_indexes` in a production dump stays readable across the boundary.
--
-- TWO CONSEQUENCES, BOTH FIXED HERE RATHER THAN LEFT FOR THE FIRST 500
-- --------------------------------------------------------------------
-- 1. `ON CONFLICT (cols)` infers its index by name-equivalence, and a partial index is
--    only inferable when the statement restates the predicate. Every upsert aimed at a
--    converted surface therefore now passes `targetWhere` (23 call sites), or Postgres
--    rejects it with 42P10 before it runs. The screen reads the call sites and fails on
--    a missing `targetWhere`, because the failure would otherwise be a route 500 weeks
--    from now, in code nobody is looking at.
-- 2. Key-resolving reads. A unique lookup that does not filter `deleted_at` can now
--    match a tombstone and a live row at once, and returns whichever Postgres reaches
--    first. 15 of the 26 converted tables have no code path that writes `deleted_at` at
--    all (measured over every `deletedAt:` assignment in app/, lib/ and scripts/), so
--    their reads cannot meet a tombstone yet; the 11 that can — tenants, roles, teams,
--    team_members, invoices, orders, forms, record_links, custom_field_defs,
--    custom_entities, product_templates — had every key-resolution site audited, and the
--    ones that resolve a single row now carry `isNull(<table>.deletedAt)`.
--
-- Rollback caveat, stated rather than hidden: the down file rebuilds the tombstone
-- inclusive index, which fails if anything created under this migration made use of the
-- reuse it grants (a second live "Sales" team, a re-issued invoice number). That is the
-- intended property of the fix, so the rollback is a data decision, not a free revert.

-- automation_workflows: index idx_automation_workflows_tenant_workflow
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_automation_workflows_tenant_workflow_live" ON "public"."automation_workflows" ("tenant_id", "workflow_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_automation_workflows_tenant_workflow";

-- contact_emails: index idx_contact_emails_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_contact_emails_unique_live" ON "public"."contact_emails" ("contact_id", "email") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_contact_emails_unique";

-- custom_field_defs: index idx_custom_fields_unique_key
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_custom_fields_unique_key_live" ON "public"."custom_field_defs" ("tenant_id", "entity_type", "field_key") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_custom_fields_unique_key";

-- dashboard_templates: constraint dashboard_templates_slug_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "dashboard_templates_slug_unique_live" ON "public"."dashboard_templates" ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "dashboard_templates" DROP CONSTRAINT IF EXISTS "dashboard_templates_slug_unique";

-- email_warmup_configs: index idx_email_warmup_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_email_warmup_unique_live" ON "public"."email_warmup_configs" ("tenant_id", "from_email") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_email_warmup_unique";

-- field_permissions: index idx_field_permissions_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_field_permissions_unique_live" ON "public"."field_permissions" ("tenant_id", "role_id", "entity_type", "field_name") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_field_permissions_unique";

-- forms: constraint forms_slug_unique (+ idx_forms_slug, already gone)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_forms_slug_live" ON "public"."forms" ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "forms" DROP CONSTRAINT IF EXISTS "forms_slug_unique";
-- idx_forms_slug was 0116's (#2264) duplicate of the constraint above and is not in
-- a chain-applied database. The DROP is kept as the statement that makes an
-- out-of-band `drizzle-kit push` match this file too; it is a no-op otherwise.
DROP INDEX CONCURRENTLY IF EXISTS "idx_forms_slug";

-- invitations: index idx_invitations_tenant_email
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_invitations_tenant_email_live" ON "public"."invitations" ("tenant_id", "email") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_invitations_tenant_email";

-- invoices: index idx_invoices_number
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_invoices_number_live" ON "public"."invoices" ("tenant_id", "invoice_number") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_invoices_number";

-- lead_warming_schedule: index idx_lead_warming_sched_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_lead_warming_sched_unique_live" ON "public"."lead_warming_schedule" ("contact_id", "campaign_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_lead_warming_sched_unique";

-- onboarding_progress: index idx_onboarding_progress_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_onboarding_progress_unique_live" ON "public"."onboarding_progress" ("tenant_id", "user_id", "step_name") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_onboarding_progress_unique";

-- orders: index idx_orders_number
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_orders_number_live" ON "public"."orders" ("tenant_id", "order_number") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_orders_number";

-- pipeline_health_metrics: index idx_pipeline_health_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_pipeline_health_unique_live" ON "public"."pipeline_health_metrics" ("pipeline_id", "metric_date") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_pipeline_health_unique";

-- price_book_entries: index idx_price_book_entries_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_price_book_entries_unique_live" ON "public"."price_book_entries" ("price_book_id", "product_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_price_book_entries_unique";

-- product_templates: constraint product_templates_slug_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "product_templates_slug_unique_live" ON "public"."product_templates" ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "product_templates" DROP CONSTRAINT IF EXISTS "product_templates_slug_unique";

-- record_links: index idx_record_links_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_record_links_unique_live" ON "public"."record_links" ("tenant_id", "from_type", "from_id", "to_type", "to_id", "relation") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_record_links_unique";

-- report_templates: constraint report_templates_slug_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "report_templates_slug_unique_live" ON "public"."report_templates" ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "report_templates" DROP CONSTRAINT IF EXISTS "report_templates_slug_unique";

-- roles: index idx_roles_tenant_slug
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_roles_tenant_slug_live" ON "public"."roles" ("tenant_id", "slug") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_roles_tenant_slug";

-- team_members: index idx_team_members_team_user
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_team_members_team_user_live" ON "public"."team_members" ("team_id", "user_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_team_members_team_user";

-- teams: index idx_teams_tenant_name
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_teams_tenant_name_live" ON "public"."teams" ("tenant_id", "name") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_teams_tenant_name";

-- tenant_members: index idx_tenant_members_tenant_user
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_tenant_members_tenant_user_live" ON "public"."tenant_members" ("tenant_id", "user_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_members_tenant_user";

-- tenant_modules: index idx_tenant_modules_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_tenant_modules_unique_live" ON "public"."tenant_modules" ("tenant_id", "module_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_modules_unique";

-- tenant_templates: index idx_tenant_templates_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_tenant_templates_unique_live" ON "public"."tenant_templates" ("tenant_id", "template_id") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenant_templates_unique";

-- tenants: index idx_tenants_short_code
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_tenants_short_code_live" ON "public"."tenants" ("short_code") WHERE deleted_at IS NULL AND (short_code IS NOT NULL);
DROP INDEX CONCURRENTLY IF EXISTS "idx_tenants_short_code";

-- tenants: constraint tenants_custom_domain_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "tenants_custom_domain_unique_live" ON "public"."tenants" ("custom_domain") WHERE deleted_at IS NULL;
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_custom_domain_unique";

-- tenants: constraint tenants_slug_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "tenants_slug_unique_live" ON "public"."tenants" ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_slug_unique";

-- webhook_field_mappings: index idx_webhook_field_mappings_unique
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_webhook_field_mappings_unique_live" ON "public"."webhook_field_mappings" ("tenant_id", "api_key_id", "entity_type", "source_key") WHERE deleted_at IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "idx_webhook_field_mappings_unique";

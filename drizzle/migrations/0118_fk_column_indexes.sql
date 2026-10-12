/*! NuCRM Enterprise — Issue #2261: index every unindexed single-column FK (100) */
--
-- 1. Rationale. A foreign-key column with no supporting btree index forces
--    PostgreSQL to seq-scan the child table on every parent UPDATE/DELETE
--    (referential check) and on child inserts against a hot parent. Most of
--    these are the audit `created_by/updated_by/deleted_by` columns, whose
--    absence was only noticed when admin deletes started timing out in dev.
--
-- 2. Detection. The exact list is derived from pg_catalog, not guessed:
--    FKs with cardinality(conkey)=1 whose column is not covered by any index
--    (`con.conkey::int[] <@ i.indkey::int[]`). Verified at head (fresh replay
--    of 0001..0117) = 100 rows; multi-column FKs: 0 rows (all covered).
--    Read-only probe of the LIVE database returned a strict superset (171) —
--    all 100 head rows are unindexed there too, and the 5 extra live columns
--    (created_by/assigned_to variants) are handled by migrations 0108+ that
--    prod hasn't deployed yet. This migration is therefore minimal and
--    safe-forward for prod's full-chain apply.
--
-- 3. Why plain CREATE INDEX (not CONCURRENTLY). The incremental drizzle-orm
--    migrator wraps each migration file in a transaction, and CREATE INDEX
--    CONCURRENTLY aborts inside one — a fresh deploy of this file on the
--    running host would fail mid-migration. Pre-launch row counts make the
--    blocking build sub-second; post-launch growth is #2262's problem with a
--    proper online-migration runner.
--
-- 4. Naming/idempotency. Every index is `<table>_<col>_fk_idx` (the issue's
--    convention), all <= 63 chars, no collisions with existing index names,
--    no duplicate table|column pairs, and IF NOT EXISTS keeps re-runs cheap.
--
CREATE INDEX IF NOT EXISTS "ai_email_drafts_deleted_by_fk_idx" ON "public"."ai_email_drafts" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_email_drafts_updated_by_fk_idx" ON "public"."ai_email_drafts" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_providers_created_by_fk_idx" ON "public"."ai_providers" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_providers_deleted_by_fk_idx" ON "public"."ai_providers" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_providers_updated_by_fk_idx" ON "public"."ai_providers" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_deleted_by_fk_idx" ON "public"."announcements" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_updated_by_fk_idx" ON "public"."announcements" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_deleted_by_fk_idx" ON "public"."automations" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_updated_by_fk_idx" ON "public"."automations" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_workflows_deleted_by_fk_idx" ON "public"."automation_workflows" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_workflows_updated_by_fk_idx" ON "public"."automation_workflows" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_records_deleted_by_fk_idx" ON "public"."backup_records" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_records_updated_by_fk_idx" ON "public"."backup_records" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canned_responses_deleted_by_fk_idx" ON "public"."canned_responses" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canned_responses_updated_by_fk_idx" ON "public"."canned_responses" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_email_drafts_deleted_by_fk_idx" ON "public"."comm_email_drafts" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_email_drafts_updated_by_fk_idx" ON "public"."comm_email_drafts" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_deleted_by_fk_idx" ON "public"."companies" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_updated_by_fk_idx" ON "public"."companies" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_deleted_by_fk_idx" ON "public"."contacts" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_updated_by_fk_idx" ON "public"."contacts" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_deleted_by_fk_idx" ON "public"."contracts" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_updated_by_fk_idx" ON "public"."contracts" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "critical_data_backups_deleted_by_fk_idx" ON "public"."critical_data_backups" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "critical_data_backups_updated_by_fk_idx" ON "public"."critical_data_backups" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_layouts_deleted_by_fk_idx" ON "public"."dashboard_layouts" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_layouts_updated_by_fk_idx" ON "public"."dashboard_layouts" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_deleted_by_fk_idx" ON "public"."dashboards" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_updated_by_fk_idx" ON "public"."dashboards" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_deleted_by_fk_idx" ON "public"."deals" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_updated_by_fk_idx" ON "public"."deals" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dunning_settings_deleted_by_fk_idx" ON "public"."dunning_settings" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dunning_settings_updated_by_fk_idx" ON "public"."dunning_settings" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_deleted_by_fk_idx" ON "public"."follow_ups" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_updated_by_fk_idx" ON "public"."follow_ups" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_deleted_by_fk_idx" ON "public"."forms" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_updated_by_fk_idx" ON "public"."forms" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_invited_by_fk_idx" ON "public"."invitations" ("invited_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_deleted_by_fk_idx" ON "public"."invoice_payments" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_recorded_by_fk_idx" ON "public"."invoice_payments" ("recorded_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_updated_by_fk_idx" ON "public"."invoice_payments" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_deleted_by_fk_idx" ON "public"."invoices" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_updated_by_fk_idx" ON "public"."invoices" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_deleted_by_fk_idx" ON "public"."kb_articles" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_updated_by_fk_idx" ON "public"."kb_articles" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_categories_deleted_by_fk_idx" ON "public"."kb_categories" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_categories_updated_by_fk_idx" ON "public"."kb_categories" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_offers_deleted_by_fk_idx" ON "public"."lead_offers" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_offers_updated_by_fk_idx" ON "public"."lead_offers" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_deleted_by_fk_idx" ON "public"."leads" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_updated_by_fk_idx" ON "public"."leads" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_scoring_rules_deleted_by_fk_idx" ON "public"."lead_scoring_rules" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_deleted_by_fk_idx" ON "public"."meetings" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_updated_by_fk_idx" ON "public"."meetings" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_deleted_by_fk_idx" ON "public"."notes" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_updated_by_fk_idx" ON "public"."notes" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_deleted_by_fk_idx" ON "public"."orders" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_updated_by_fk_idx" ON "public"."orders" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_books_deleted_by_fk_idx" ON "public"."price_books" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_books_updated_by_fk_idx" ON "public"."price_books" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_deleted_by_fk_idx" ON "public"."products" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_updated_by_fk_idx" ON "public"."products" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_deleted_by_fk_idx" ON "public"."projects" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_updated_by_fk_idx" ON "public"."projects" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_deleted_by_fk_idx" ON "public"."quotes" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_updated_by_fk_idx" ON "public"."quotes" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_links_deleted_by_fk_idx" ON "public"."record_links" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_links_updated_by_fk_idx" ON "public"."record_links" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_reports_deleted_by_fk_idx" ON "public"."saved_reports" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_reports_updated_by_fk_idx" ON "public"."saved_reports" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_reports_deleted_by_fk_idx" ON "public"."scheduled_reports" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_reports_updated_by_fk_idx" ON "public"."scheduled_reports" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_deleted_by_fk_idx" ON "public"."segments" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_updated_by_fk_idx" ON "public"."segments" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selective_restore_logs_backup_id_fk_idx" ON "public"."selective_restore_logs" ("backup_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequences_deleted_by_fk_idx" ON "public"."sequences" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequences_updated_by_fk_idx" ON "public"."sequences" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_categories_deleted_by_fk_idx" ON "public"."service_categories" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_categories_updated_by_fk_idx" ON "public"."service_categories" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_deleted_by_fk_idx" ON "public"."services" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_updated_by_fk_idx" ON "public"."services" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_subscriptions_deleted_by_fk_idx" ON "public"."service_subscriptions" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_subscriptions_updated_by_fk_idx" ON "public"."service_subscriptions" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_deleted_by_fk_idx" ON "public"."support_tickets" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_sla_policy_id_fk_idx" ON "public"."support_tickets" ("sla_policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_updated_by_fk_idx" ON "public"."support_tickets" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_deleted_by_fk_idx" ON "public"."tasks" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_updated_by_fk_idx" ON "public"."tasks" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_deleted_by_fk_idx" ON "public"."team_members" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_updated_by_fk_idx" ON "public"."team_members" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_deleted_by_fk_idx" ON "public"."teams" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_updated_by_fk_idx" ON "public"."teams" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_ai_credentials_created_by_fk_idx" ON "public"."tenant_ai_credentials" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_ai_credentials_deleted_by_fk_idx" ON "public"."tenant_ai_credentials" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_ai_credentials_updated_by_fk_idx" ON "public"."tenant_ai_credentials" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_departures_deleted_by_fk_idx" ON "public"."user_departures" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_departures_updated_by_fk_idx" ON "public"."user_departures" ("updated_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_deleted_by_fk_idx" ON "public"."users" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_deleted_by_fk_idx" ON "public"."workflows" ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_updated_by_fk_idx" ON "public"."workflows" ("updated_by");

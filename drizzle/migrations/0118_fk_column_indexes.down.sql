/*! NuCRM Enterprise — Issue #2261 down: drop the 100 FK-support indexes */
-- Reversal is exact: every index was created here, none is constraint-backed,
-- and no later migration depends on them. Plain DROP INDEX is safe in a tx.
--
DROP INDEX IF EXISTS "public"."ai_email_drafts_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."ai_email_drafts_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."ai_providers_created_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."ai_providers_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."ai_providers_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."announcements_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."announcements_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."automations_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."automations_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."automation_workflows_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."automation_workflows_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."backup_records_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."backup_records_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."canned_responses_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."canned_responses_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."comm_email_drafts_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."comm_email_drafts_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."companies_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."companies_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."contacts_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."contacts_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."contracts_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."contracts_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."critical_data_backups_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."critical_data_backups_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dashboard_layouts_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dashboard_layouts_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dashboards_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dashboards_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."deals_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."deals_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dunning_settings_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."dunning_settings_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."follow_ups_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."follow_ups_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."forms_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."forms_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invitations_invited_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invoice_payments_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invoice_payments_recorded_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invoice_payments_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invoices_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."invoices_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."kb_articles_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."kb_articles_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."kb_categories_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."kb_categories_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."lead_offers_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."lead_offers_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."leads_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."leads_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."lead_scoring_rules_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."meetings_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."meetings_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."notes_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."notes_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."orders_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."orders_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."price_books_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."price_books_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."products_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."products_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."projects_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."projects_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."quotes_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."quotes_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."record_links_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."record_links_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."saved_reports_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."saved_reports_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."scheduled_reports_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."scheduled_reports_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."segments_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."segments_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."selective_restore_logs_backup_id_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."sequences_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."sequences_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."service_categories_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."service_categories_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."services_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."services_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."service_subscriptions_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."service_subscriptions_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."support_tickets_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."support_tickets_sla_policy_id_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."support_tickets_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."tasks_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."tasks_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."team_members_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."team_members_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."teams_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."teams_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."tenant_ai_credentials_created_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."tenant_ai_credentials_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."tenant_ai_credentials_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."user_departures_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."user_departures_updated_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."users_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."workflows_deleted_by_fk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."workflows_updated_by_fk_idx";

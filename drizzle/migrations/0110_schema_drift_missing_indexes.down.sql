-- 0110 down: drop the 14 indexes created by 0110_schema_drift_missing_indexes.sql (#2255).
DROP INDEX IF EXISTS "idx_tickets_tenant_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tickets_assigned";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tenant_hierarchy_child";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tenant_hierarchy_parent";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tasks_created_by";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tasks_tenant_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_page_views_visitor";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_meetings_tenant_start_active";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_meetings_created_by";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_deals_close_date";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_deals_tenant_stage";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_contacts_created_by";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_email_drafts_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_invitations_tenant_email";

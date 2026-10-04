-- 0110: create 14 indexes declared in drizzle/schema but never created live (#2255).
--
-- The live-DB audit found indexes that schema code declared but no migration
-- ever emitted ("declared-but-not-created" drift). Each was verified against
-- information_schema/pg_indexes on the migrated dev DB as genuinely absent —
-- not renamed twins (those were fixed in schema code in this same PR).
-- Every statement is IF NOT EXISTS so this file is a no-op on any DB that
-- already has the index (e.g. if a future hotfix created one out-of-band).
--
-- Hot-path motivation (see issue body):
--   * idx_deals_tenant_stage  — the board query (WHERE tenant_id = ? AND stage_id ...)
--   * idx_deals_close_date    — pipeline date filters seq-scanned deals
--   * idx_tickets_assigned / idx_tickets_tenant_status — support list views
--   * idx_tenant_hierarchy_parent/_child — tenant_hierarchy had ZERO secondary
--     indexes; every tenant delete seq-scanned it (also #2261's worst offender)
--   * idx_*_created_by — audit/ownership filters on contacts/deals/meetings/tasks
--   * idx_invitations_tenant_email UNIQUE — pre-check dedup for invite resend;
--     verified 0 duplicate (tenant_id, email) rows on the live DB before adding.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_tenant_email" ON "invitations" ("tenant_id", "email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_email_drafts_user" ON "ai_email_drafts" ("tenant_id", "created_by", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contacts_created_by" ON "contacts" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deals_tenant_stage" ON "deals" ("tenant_id", "stage_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deals_close_date" ON "deals" ("close_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meetings_created_by" ON "meetings" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meetings_tenant_start_active" ON "meetings" ("tenant_id", "start_time") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_page_views_visitor" ON "page_views" ("visitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_status" ON "tasks" ("tenant_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_created_by" ON "tasks" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_hierarchy_parent" ON "tenant_hierarchy" ("parent_tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_hierarchy_child" ON "tenant_hierarchy" ("child_tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_assigned" ON "support_tickets" ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_tenant_status" ON "support_tickets" ("tenant_id", "status");

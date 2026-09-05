-- 0085: composite indexes for dashboard/usage hot paths.
--
-- The dashboard, usage analytics and widgets filter by tenant (+ user/status)
-- and sort by created_at/due_date on every poll. Single-column indexes force
-- seq-scan + sort on the managed DB; each amplified by ~245ms WAN RTT per
-- query. These composites match the actual WHERE + ORDER BY shapes.
--
-- Idempotent: IF NOT EXISTS on every statement.

CREATE INDEX IF NOT EXISTS "idx_activities_tenant_created" ON "activities" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_tenant_user_created" ON "notifications" ("tenant_id", "user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_tenant_status_due" ON "follow_ups" ("tenant_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_log_tenant_created" ON "email_log" ("tenant_id", "created_at");

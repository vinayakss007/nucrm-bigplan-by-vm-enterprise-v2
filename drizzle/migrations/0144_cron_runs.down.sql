-- Down migration for 0144: drop the cron run ledger (#3410).
DROP POLICY IF EXISTS "cron_runs_super_admin_delete" ON "cron_runs";
--> statement-breakpoint
DROP POLICY IF EXISTS "cron_runs_super_admin_read" ON "cron_runs";
--> statement-breakpoint
DROP POLICY IF EXISTS "cron_runs_insert_any" ON "cron_runs";
--> statement-breakpoint
ALTER TABLE IF EXISTS "cron_runs" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_cron_runs_started";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_cron_runs_job_started";
--> statement-breakpoint
DROP TABLE IF EXISTS "cron_runs";

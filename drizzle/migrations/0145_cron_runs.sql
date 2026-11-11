-- 0145: cron run ledger (#3410).
--
-- /api/system/cron-health could only report what the answering process
-- remembered since boot: lib/cron/health.ts is an in-memory map with no
-- writer, so a job that had never run in production looked fine. This table
-- is the durable half: lib/cron/cron-lock.ts writes one row per attempt —
-- ok, error, or skipped-by-lock — and the health endpoint compares it to
-- lib/cron/jobs.ts.
--
-- Platform-level: cron runs are not tenant data, so there is no tenant_id
-- and no tenant_isolation policy. RLS is still ENABLE + FORCE because the
-- app role owns the tables and a policy-less table is a policy of "anything
-- the role does" — the shape #3405 is auditing fleet-wide. The writer needs
-- to work with no GUC set (a cron request authenticates by CRON_SECRET, not
-- a session), so INSERT is permissive exactly like error_logs (0088):
-- append-only telemetry with loud reads. Reads/deletes are super-admin-gated:
-- /api/system/cron-health runs behind requireAuth (which sets
-- app.is_super_admin session-scoped) and the prune runs inside the cleanup
-- cron under the same marker.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS on every statement.
-- Indexes are CONCURRENTLY (#3301: scripts/migrate.ts routes any file carrying
-- them through applyMigrationFile, outside the backlog transaction; the table
-- is minutes old and empty here, so the build cannot block anything anyway).

CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "ok" boolean NOT NULL,
  "error" text,
  "duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_cron_runs_job_started" ON "cron_runs" ("job", "started_at");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_cron_runs_started" ON "cron_runs" ("started_at");
--> statement-breakpoint
ALTER TABLE "cron_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cron_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "cron_runs_insert_any" ON "cron_runs";
--> statement-breakpoint
CREATE POLICY "cron_runs_insert_any" ON "cron_runs" FOR INSERT WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "cron_runs_super_admin_read" ON "cron_runs";
--> statement-breakpoint
CREATE POLICY "cron_runs_super_admin_read" ON "cron_runs" FOR SELECT USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
--> statement-breakpoint
DROP POLICY IF EXISTS "cron_runs_super_admin_delete" ON "cron_runs";
--> statement-breakpoint
CREATE POLICY "cron_runs_super_admin_delete" ON "cron_runs" FOR DELETE USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);

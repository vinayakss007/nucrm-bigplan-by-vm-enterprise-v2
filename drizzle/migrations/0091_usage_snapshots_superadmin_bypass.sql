-- 0091: super-admin bypass for usage_snapshots.
--
-- The weekly usage-snapshot cron runs platform-wide (no tenant) under the
-- super-admin GUC and calls snapshot_tenant_usage(), which inserts here.
-- Without a bypass the job died with an RLS violation every run (NUCRM-D).
-- Tenant isolation for ordinary requests is unchanged (ORed branches).
DROP POLICY IF EXISTS "tenant_isolation" ON "usage_snapshots";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "usage_snapshots" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

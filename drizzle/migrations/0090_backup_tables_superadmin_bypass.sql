-- 0090: super-admin bypass for the backup-record tables.
--
-- The hourly auto-backup cron runs platform-wide (no tenant) under the
-- super-admin GUC. backup_schedules already admitted that context (NUCRM-8),
-- but tenant_backup_records and critical_data_backups did not, so the first
-- real backup run died on INSERT (NUCRM-P) and the retention cleanup/purge
-- DELETEs could never match rows either. Per-tenant backup content runs under
-- the tenant's own context (see the route); this bypass covers only the
-- cross-tenant maintenance statements plus defense-in-depth. Tenant isolation
-- for ordinary requests is unchanged: both branches are ORed, tenant match
-- still admits a properly-scoped request.
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_backup_records";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_backup_records" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "critical_data_backups";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "critical_data_backups" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

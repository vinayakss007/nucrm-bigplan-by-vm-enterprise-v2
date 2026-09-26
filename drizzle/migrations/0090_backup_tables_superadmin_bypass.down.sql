-- 0090 down: restore the fail-closed tenant-only policies (0039 form).
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_backup_records";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_backup_records"
FOR ALL
USING (
  tenant_id IS NULL
  OR tenant_id = (
    CASE
      WHEN NULLIF(current_setting('app.current_tenant', true), '') IS NULL THEN NULL
      ELSE NULLIF(current_setting('app.current_tenant', true), '')::uuid
    END
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "critical_data_backups";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "critical_data_backups"
FOR ALL
USING (
  tenant_id IS NULL
  OR tenant_id = (
    CASE
      WHEN NULLIF(current_setting('app.current_tenant', true), '') IS NULL THEN NULL
      ELSE NULLIF(current_setting('app.current_tenant', true), '')::uuid
    END
  )
);

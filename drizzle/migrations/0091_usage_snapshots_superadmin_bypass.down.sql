-- 0091 down: restore the fail-closed tenant-only policy (0039 form).
DROP POLICY IF EXISTS "tenant_isolation" ON "usage_snapshots";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "usage_snapshots"
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

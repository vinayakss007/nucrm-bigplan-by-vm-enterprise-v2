-- 0094 (#2058): super_admin_audit_logs.tenant_id text -> uuid.
--
-- The Drizzle schema already declares uuid('tenant_id'), but the live column
-- is text, so the isolation gate reports the table as the one tenant-scoped
-- table the standard uuid policy template cannot cover ("tenant_id present
-- but NOT uuid"). Valid uuid strings are kept; blank/garbage values become
-- NULL (the column is nullable and this is an audit side-table — tenant_name
-- is preserved alongside). Then replace the old text-comparison policy with
-- the standard uuid template.
--> statement-breakpoint
-- Drop first: the existing policy references the column in a text comparison,
-- which would block the type change.
DROP POLICY IF EXISTS "tenant_isolation" ON "super_admin_audit_logs";
--> statement-breakpoint
-- Guarded so the migration is re-runnable if the column is already uuid
-- (the Drizzle schema declared uuid long before the DB matched it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'super_admin_audit_logs' AND column_name = 'tenant_id' AND data_type <> 'uuid'
  ) THEN
    EXECUTE $mig$
      ALTER TABLE "super_admin_audit_logs" ALTER COLUMN "tenant_id" TYPE uuid USING (
        CASE
          WHEN "tenant_id" IS NULL THEN NULL
          WHEN btrim("tenant_id") ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN btrim("tenant_id")::uuid
          ELSE NULL
        END
      )
    $mig$;
  END IF;
END $$;
--> statement-breakpoint
--> statement-breakpoint
-- Standard form used by the 0090–0093 bypass migrations: exact-tenant match
-- OR super-admin context, with NO "tenant_id IS NULL" admit — NULL-tenant
-- rows on this table are platform actions and must stay super-admin-only.
CREATE POLICY "tenant_isolation" ON "super_admin_audit_logs" FOR ALL USING (
  ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

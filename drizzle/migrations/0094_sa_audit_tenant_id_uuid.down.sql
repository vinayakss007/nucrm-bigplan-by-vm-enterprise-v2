-- 0094 down (#2058): restore text tenant_id and the old text-comparison policy.
DROP POLICY IF EXISTS "tenant_isolation" ON "super_admin_audit_logs";
--> statement-breakpoint
ALTER TABLE "super_admin_audit_logs" ALTER COLUMN "tenant_id" TYPE text USING ("tenant_id"::text);
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "super_admin_audit_logs" FOR ALL USING (
  ("tenant_id" IS NULL) OR ("tenant_id" = current_setting('app.current_tenant', true))
);

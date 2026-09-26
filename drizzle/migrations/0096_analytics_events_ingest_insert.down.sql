-- 0096 down: restore the 0088 insert policy verbatim.
DROP POLICY IF EXISTS "analytics_events_insert" ON "analytics_events";
--> statement-breakpoint
CREATE POLICY "analytics_events_insert" ON "analytics_events" FOR INSERT WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR (tenant_id IS NULL AND (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

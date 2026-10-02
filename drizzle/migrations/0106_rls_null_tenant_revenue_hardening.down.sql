-- 0106 rollback (#2234).
--
-- Restores the pre-0106 policy definitions verbatim: the 0039-era
-- `tenant_id IS NULL OR tenant_id = current_setting(...)` FOR ALL policy with NO
-- WITH CHECK on the five revenue tables. Restoring them is a rollback, not an
-- endorsement — that shape is exactly the cross-tenant leak #2234 describes
-- (NULL-tenant rows readable by every tenant, INSERT/UPDATE to NULL tenant_id
-- unchecked). See the WHY block in the UP file.
--
-- NOT reverted on purpose:
--   * tenant_id SET NOT NULL and the FK to tenants(id) — dropping them would
--     fight the Drizzle schema (utils.tenantId() declares NOT NULL + cascade FK)
--     and re-opening the constraint is never a safe automatic step; 0088's
--     rollback follows the same rule for structural protection.
--   * the tenant_id support indexes — harmless and used by the policy predicate.
--   * ENABLE / FORCE ROW LEVEL SECURITY — disabling protection is never an
--     automatic rollback step.

--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invoice_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_line_items" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "order_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_line_items" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invoice_payments";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_payments" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "quote_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_line_items" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "deal_stages";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deal_stages" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

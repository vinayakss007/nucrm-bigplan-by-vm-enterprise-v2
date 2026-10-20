/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0131: let a platform-security context READ the per-tenant usage ledger (#2880).
--
-- `GET /api/superadmin/token-control/report/top-spenders` is a platform report: it
-- aggregates `ai_usage_aggregated` across every tenant. That table's policy is the
-- looped one from `0037_tenant_isolation_hardening.sql:245-252` —
--
--   tenant_isolation FOR ALL
--     USING (tenant_id::text = current_setting('app.current_tenant'))
--
-- with no super-admin branch: `tenant_id` is NOT NULL here, so the loop took the
-- strict arm and never emitted the `tenant_id IS NULL` half. `lib/db/pool.ts:241`
-- pins `app.current_tenant` to '' on every checkout, and the nil-UUID sentinel a
-- tenant-less console session carries matches no tenant — so the report would have
-- answered `200 {"tenants": []}` on an install with a full ledger. A write that
-- cannot see its own rows is a loud 42501; a read that cannot see anyone else's is
-- a quiet empty list, which is the failure `lib/cron/tenant-scope.ts:29-34` names
-- "worse than a failure because it is indistinguishable from success".
--
-- The waiver is additive and SELECT-only, in the shape `0088_rls_bootstrap_and_isolation.sql`
-- already uses for `error_logs`, `security_events` and the rest of the telemetry set.
-- Deliberately it does NOT touch `tenant_isolation`: permissive policies of the same
-- command are OR-ed, so the tenant keeps its own rows through the existing policy and
-- the platform console gains the cross-tenant read — while INSERT/UPDATE keep running
-- through the FOR ALL policy unchanged. Recreating that policy as FOR SELECT, the way
-- `0088` did for the tables it paired with explicit write policies, would have left
-- `recordUsage()` (`lib/ai/common.ts:193-227`) with no policy to write under: RLS is
-- default-deny once enabled, so the budget books would have stopped accruing.
--
-- Scope: reads only, and only for a context that `withSecurityContext()` established —
-- which is a `SET LOCAL` inside one transaction (`lib/db/rls.ts:181-191`), reset on
-- checkout by `lib/db/pool.ts:241`. Nothing here widens what a tenant session can see.
--
-- Rollback: `0131_super_admin_usage_read.down.sql`.

--> statement-breakpoint
DROP POLICY IF EXISTS "ai_usage_aggregated_super_admin_read" ON "ai_usage_aggregated";
--> statement-breakpoint
CREATE POLICY "ai_usage_aggregated_super_admin_read" ON "ai_usage_aggregated" FOR SELECT USING (
  ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

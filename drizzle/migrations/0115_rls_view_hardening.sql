/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2263 — RLS coverage gaps: the one view that bypassed tenant isolation, and
-- the one base table whose posture was undeclared.
--
-- 1. `deals_by_win_probability` (created in 0002) is a plain VIEW, which in
--    Postgres executes with the OWNER's privileges. The owner is exempt from
--    the base tables' `tenant_isolation` policies, so
--    `SELECT * FROM deals_by_win_probability` reads EVERY tenant's deals —
--    silently cross-tenant the moment the app stops connecting as superuser
--    (the invariant #2306 put on a schedule and the provisioned app role
--    exists to enforce). `WITH (security_invoker = on)` makes the view scan
--    `deals`/`deal_stages` as the CALLING user, with their RLS applied. The
--    body below is byte-identical to 0002's — only the option changes — so
--    CREATE OR REPLACE keeps the column list stable.
--    Recorded limitation: drizzle-orm 0.45 cannot express view reloptions, so
--    this property lives in SQL only; a `drizzle-kit push` would drop it. The
--    nightly verify-tenant-isolation survey is the guard against that, and
--    tests/unit/rls-view-hardening-2263.test.ts pins this migration's shape.
--
-- 2. `ai_providers` is a global read-only catalog at runtime: the per-tenant
--    AI key/config surface is `tenants.settings.ai_providers` jsonb + the
--    encrypted key table (see drizzle/schema/ai.ts header), and nothing in
--    app/ or lib/ writes this table — only scripts/seed-dev.ts does. That
--    posture was undocumented, which is how the table stayed invisible to the
--    isolation survey (PP-042). It now declares itself in the database the
--    same way the other global registries do (0054_rls_phase0): RLS enabled,
--    SELECT for everyone, writes gated on the super-admin GUC.
--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."deals_by_win_probability" WITH (security_invoker = on) AS (
  SELECT
    d.id,
    d.tenant_id,
    d.title,
    d.amount,
    d.close_date,
    d.stage_id,
    ds.name AS stage_name,
    ds."order" AS stage_order,
    d.pipeline_id,
    d.assigned_to,
    d.contact_id,
    d.company_id,
    d.created_at,
    d.updated_at,
    GREATEST(0.05, LEAST(0.95, ds."order"::numeric / NULLIF(pm.max_order, 0)::numeric)) AS probability
  FROM deals d
  JOIN deal_stages ds ON d.stage_id = ds.id
  CROSS JOIN LATERAL (
    SELECT MAX(ds2."order") AS max_order
    FROM deal_stages ds2
    WHERE ds2.pipeline_id = ds.pipeline_id
  ) pm
  WHERE d.deleted_at IS NULL
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_providers_read_all ON ai_providers FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY ai_providers_super_admin_write ON ai_providers FOR ALL USING (
  current_setting('app.is_super_admin', true)::boolean = true
);

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2263 down: restore the invoker-privileged view and un-declare ai_providers.
-- Reverting the view option RE-OPENS the cross-tenant read path; this down
-- exists for chain completeness, not as a safe rollback target.
--> statement-breakpoint
DROP POLICY IF EXISTS ai_providers_read_all ON ai_providers;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_providers_super_admin_write ON ai_providers;
--> statement-breakpoint
ALTER TABLE "ai_providers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."deals_by_win_probability" AS (
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

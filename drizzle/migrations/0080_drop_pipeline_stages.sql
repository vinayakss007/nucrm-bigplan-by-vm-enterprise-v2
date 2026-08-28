-- 0080: drop the duplicate pipeline_stages table (issue #1337).
--
-- pipeline_stages duplicated deal_stages (the canonical table that
-- deals.stage_id references and that every pipeline/deal/onboarding flow uses).
-- Its only writer — app/api/tenant/modules/setup — was pointed at deal_stages
-- in this change, so template-created stages now actually work with deals.
-- Nothing references pipeline_stages (no FK targets it), leaving it dead.
--
-- Guarded IF EXISTS so this is a no-op where a prior cleanup already removed it.
-- Note: rows that were written into pipeline_stages by the old (buggy)
-- modules/setup flow were never usable (no deal could reference them), so no
-- data migration is warranted.

DROP TABLE IF EXISTS "pipeline_stages" CASCADE;

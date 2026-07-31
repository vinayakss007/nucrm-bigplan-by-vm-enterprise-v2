-- Rollback 0019_add_stage_entered_at: Remove column from deals
ALTER TABLE "deals" DROP COLUMN IF EXISTS "stage_entered_at";

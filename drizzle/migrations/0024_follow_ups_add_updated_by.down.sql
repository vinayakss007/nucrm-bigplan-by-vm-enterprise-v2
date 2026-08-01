-- Rollback 0022_follow_ups_add_updated_by: Remove column
ALTER TABLE "follow_ups" DROP COLUMN IF EXISTS "updated_by";

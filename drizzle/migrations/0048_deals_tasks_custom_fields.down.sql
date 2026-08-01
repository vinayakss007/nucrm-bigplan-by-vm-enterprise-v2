-- Rollback for 0048_deals_tasks_custom_fields
BEGIN;
DROP INDEX IF EXISTS "idx_deals_custom_fields_g";
DROP INDEX IF EXISTS "idx_tasks_custom_fields_g";
ALTER TABLE "deals" DROP COLUMN IF EXISTS "custom_fields";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "custom_fields";
COMMIT;

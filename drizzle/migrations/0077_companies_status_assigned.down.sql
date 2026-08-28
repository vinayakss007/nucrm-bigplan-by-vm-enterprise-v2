-- Rollback 0077: remove the companies columns/FK/indexes added for #1084.
DROP INDEX IF EXISTS "idx_companies_assigned";
DROP INDEX IF EXISTS "idx_companies_tenant_status";
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_assigned_to_users_id_fk";
ALTER TABLE companies DROP COLUMN IF EXISTS lifecycle_stage;
ALTER TABLE companies DROP COLUMN IF EXISTS assigned_to;
ALTER TABLE companies DROP COLUMN IF EXISTS status;

-- Rollback for 0035_add_tenant_short_code
-- Reverses: ALTER TABLE tenants ADD COLUMN short_code TEXT;
--           CREATE UNIQUE INDEX idx_tenants_short_code (partial)

BEGIN;

DROP INDEX IF EXISTS idx_tenants_short_code;
ALTER TABLE tenants DROP COLUMN IF EXISTS short_code;

COMMIT;

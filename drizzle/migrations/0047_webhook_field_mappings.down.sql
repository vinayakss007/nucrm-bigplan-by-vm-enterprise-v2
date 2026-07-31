-- Rollback for 0047_webhook_field_mappings
BEGIN;
DROP INDEX IF EXISTS "idx_webhook_field_mappings_unique";
DROP INDEX IF EXISTS "idx_webhook_field_mappings_lookup";
DROP INDEX IF EXISTS "idx_webhook_field_mappings_tenant";
DROP TABLE IF EXISTS "webhook_field_mappings";
COMMIT;

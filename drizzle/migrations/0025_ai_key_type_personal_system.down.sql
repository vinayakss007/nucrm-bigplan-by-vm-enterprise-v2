-- Rollback 0023_ai_key_type_personal_system: Remove key_type column
ALTER TABLE "ai_provider_keys" DROP COLUMN IF EXISTS "key_type";

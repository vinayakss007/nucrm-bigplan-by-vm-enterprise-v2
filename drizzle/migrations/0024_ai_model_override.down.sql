-- Rollback 0024_ai_model_override: Remove model_override column
ALTER TABLE "ai_provider_keys" DROP COLUMN IF EXISTS "model_override";

-- Add model_override column to ai_provider_secrets
-- Stores per-key model selection (e.g. "deepseek-v4-flash-free", "gpt-4o")
ALTER TABLE ai_provider_secrets ADD COLUMN model_override text;

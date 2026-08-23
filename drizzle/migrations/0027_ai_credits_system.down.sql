-- Down Migration: 0027_ai_credits_system
DROP INDEX IF EXISTS idx_ai_credits_ledger_activity;
DROP INDEX IF EXISTS idx_ai_credits_ledger_period;
DROP INDEX IF EXISTS idx_ai_credits_ledger_user;
DROP INDEX IF EXISTS idx_ai_credits_ledger_tenant;
DROP TABLE IF EXISTS ai_credits_ledger;

DROP INDEX IF EXISTS idx_tenant_ai_credits_status;
DROP INDEX IF EXISTS idx_tenant_ai_credits_period;
DROP INDEX IF EXISTS idx_tenant_ai_credits_tenant;
DROP TABLE IF EXISTS tenant_ai_credits;

ALTER TABLE ai_provider_secrets DROP COLUMN IF EXISTS is_centralized;

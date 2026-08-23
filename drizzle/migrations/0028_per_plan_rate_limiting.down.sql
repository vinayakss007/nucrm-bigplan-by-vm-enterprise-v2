-- Down Migration: 0028_per_plan_rate_limiting
DROP INDEX IF EXISTS idx_plans_rate_limit;
ALTER TABLE users DROP COLUMN IF EXISTS unlimited_rate_limit;
ALTER TABLE plans DROP COLUMN IF EXISTS rate_limit_config;

-- Migration: Add per-plan rate limiting configuration
-- Adds rate_limit_config JSONB to plans table
-- Adds unlimited_rate_limit BOOLEAN to users table

-- Add rate_limit_config to plans table with default values
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "rate_limit_config" jsonb DEFAULT '{
  "api": 60,
  "auth": 5,
  "contacts": 30,
  "deals": 30,
  "export": 10,
  "import": 5,
  "ai": 30,
  "webhook": 1000,
  "passwordReset": 3,
  "emailVerification": 10,
  "bulk": 5
}'::jsonb;

-- Add unlimited_rate_limit to users table (for super admin bypass)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "unlimited_rate_limit" boolean DEFAULT false;

-- Create index for quick lookup of plan rate limits
CREATE INDEX IF NOT EXISTS idx_plans_rate_limit ON "plans" USING btree ("is_active") WHERE "is_active" = true;

-- Comment on columns
COMMENT ON COLUMN "plans"."rate_limit_config" IS 'Per-plan rate limits in requests per minute/hour. Keys: api, auth, contacts, deals, export, import, ai, webhook, passwordReset, emailVerification, bulk';
COMMENT ON COLUMN "users"."unlimited_rate_limit" IS 'When true, user bypasses all rate limits (for super admin)';

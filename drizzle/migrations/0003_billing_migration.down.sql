-- Rollback 0002_billing_migration: Revert billing schema changes
-- NOTE: This is a destructive rollback. Data in new billing columns will be lost.
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "stripe_subscription_id";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "stripe_customer_id";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "current_period_end";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "cancel_at_period_end";
DROP TABLE IF EXISTS "payment_methods" CASCADE;

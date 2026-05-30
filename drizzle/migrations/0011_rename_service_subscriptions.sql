-- Rename billing subscriptions table to service_subscriptions
-- to resolve naming collision with infra subscriptions (platform billing)
ALTER TABLE IF EXISTS subscriptions RENAME TO service_subscriptions;
ALTER INDEX IF EXISTS idx_subscriptions_contact RENAME TO idx_service_subscriptions_contact;
ALTER INDEX IF EXISTS idx_subscriptions_company RENAME TO idx_service_subscriptions_company;
ALTER INDEX IF EXISTS idx_subscriptions_status RENAME TO idx_service_subscriptions_status;

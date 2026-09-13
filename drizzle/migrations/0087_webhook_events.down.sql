-- Down migration for 0087: drop the webhook delivery ledger.
DROP INDEX IF EXISTS "idx_webhook_events_status";
DROP INDEX IF EXISTS "idx_webhook_events_tenant";
DROP INDEX IF EXISTS "uq_webhook_events_provider_event";
DROP TABLE IF EXISTS "webhook_events";

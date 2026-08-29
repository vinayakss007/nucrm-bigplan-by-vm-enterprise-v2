-- Down migration for 0082: drop the product analytics event stream.
DROP INDEX IF EXISTS "idx_analytics_events_anon";
DROP INDEX IF EXISTS "idx_analytics_events_event_time";
DROP INDEX IF EXISTS "idx_analytics_events_tenant_time";
DROP TABLE IF EXISTS "analytics_events";

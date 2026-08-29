-- 0082: product analytics event stream (app-usage tracking).
--
-- Deliberately ISOLATED, append-only. tenant_id / user_id are plain uuid
-- columns with NO foreign keys — the analytics firehose is decoupled from the
-- transactional schema so it can be partitioned, pruned on a short retention
-- window, or migrated to a dedicated store (ClickHouse / PostHog) later without
-- FK cascade coupling. is_paid / plan_id are resolved server-side at ingest
-- (lib/analytics/entitlement.ts) and are never trusted from the client.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   uuid,
  "user_id"     uuid,
  "anon_id"     text NOT NULL,
  "event_name"  text NOT NULL,
  "properties"  jsonb NOT NULL DEFAULT '{}'::jsonb,
  "url"         text DEFAULT '',
  "referrer"    text DEFAULT '',
  "session_id"  text DEFAULT '',
  "is_paid"     boolean NOT NULL DEFAULT false,
  "plan_id"     text,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_analytics_events_tenant_time" ON "analytics_events" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_event_time"  ON "analytics_events" ("event_name", "created_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_anon"        ON "analytics_events" ("anon_id");

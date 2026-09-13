-- 0087: provider-webhook delivery ledger (#1908).
--
-- Stripe/Razorpay deliver at-least-once and the Redis idempotency lock fails
-- OPEN without Redis, so replays re-ran money-affecting handlers. This table
-- is the DB-level source of truth: handlers INSERT (provider, event_id) with
-- ON CONFLICT DO NOTHING and only the winner processes.
--
-- UNIQUE(provider, event_id): event ids are globally unique per provider, so
-- the key is intentionally cross-tenant. Rows are append-only audit except
-- that failed claims are DELETED (so provider retries re-process) — see
-- lib/webhooks/idempotency.ts.
--
-- Idempotent: IF NOT EXISTS on every statement.

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text,
  "tenant_id" uuid,
  "status" text NOT NULL DEFAULT 'claimed',
  "created_at" timestamptz DEFAULT now(),
  "processed_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_webhook_events_provider_event"
  ON "webhook_events" ("provider", "event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_tenant" ON "webhook_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_status" ON "webhook_events" ("status", "created_at");

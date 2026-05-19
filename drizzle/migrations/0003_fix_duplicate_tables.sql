-- Migration: Rename webhook_deliveries to webhook_queue (support)
-- This avoids conflict with automation.webhookDeliveries
-- Generated: 2026-05-11

-- Create the new webhook_queue table with correct schema
CREATE TABLE IF NOT EXISTS "webhook_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"method" text NOT NULL DEFAULT 'POST',
	"headers" jsonb DEFAULT '{}'::jsonb,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"attempt" integer NOT NULL DEFAULT 0,
	"max_retries" integer NOT NULL DEFAULT 3,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_webhook_id" ON "webhook_queue" USING btree ("webhook_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_status" ON "webhook_queue" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_next_retry" ON "webhook_queue" USING btree ("next_retry_at") WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS "idx_webhook_queue_tenant" ON "webhook_queue" USING btree ("tenant_id");

-- Note: If the old webhook_deliveries table from support.ts had data you want to keep,
-- you'll need to manually migrate that data. The new table has the same structure.

-- Drop the old table if it exists (support schema)
-- WARNING: This will delete data from the old webhook_deliveries table
-- Uncomment the following line ONLY if you're sure you want to drop it
-- DROP TABLE IF EXISTS "webhook_deliveries";
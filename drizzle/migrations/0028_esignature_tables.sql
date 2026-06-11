-- Migration: Esignature group tables (signing_requests, signing_events)

CREATE TABLE IF NOT EXISTS "signing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"provider" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"signers" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "signing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signer_email" text NOT NULL,
	"event" text NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signing_events_request_id_signing_requests_id_fk') THEN
    ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_signing_events_request" ON "signing_events" USING btree ("request_id");
CREATE INDEX IF NOT EXISTS "idx_signing_events_tenant" ON "signing_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_signing_events_signer" ON "signing_events" USING btree ("signer_email");
CREATE INDEX IF NOT EXISTS "idx_signing_requests_tenant" ON "signing_requests" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_signing_requests_document" ON "signing_requests" USING btree ("document_id");
CREATE INDEX IF NOT EXISTS "idx_signing_requests_status" ON "signing_requests" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_signing_requests_external" ON "signing_requests" USING btree ("provider","external_id");

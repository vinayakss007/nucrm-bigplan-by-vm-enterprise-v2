CREATE TABLE IF NOT EXISTS "signing_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL,
  "provider" text NOT NULL DEFAULT 'internal',
  "status" text NOT NULL DEFAULT 'pending',
  "external_id" text,
  "signers" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_requests_tenant" ON "signing_requests" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_requests_document" ON "signing_requests" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_requests_status" ON "signing_requests" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_requests_external" ON "signing_requests" ("provider", "external_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signing_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "signing_requests"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "signer_email" text NOT NULL,
  "event" text NOT NULL,
  "event_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_events_request" ON "signing_events" ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_events_tenant" ON "signing_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signing_events_signer" ON "signing_events" ("signer_email");

CREATE TABLE IF NOT EXISTS "error_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "level" text NOT NULL DEFAULT 'error',
  "code" text,
  "message" text NOT NULL,
  "stack" text,
  "context" jsonb DEFAULT '{}'::jsonb,
  "resolved" boolean DEFAULT false,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_tenant" ON "error_logs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_user" ON "error_logs" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_level" ON "error_logs" ("level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_resolved" ON "error_logs" ("resolved");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_created" ON "error_logs" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" uuid NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_webhook_id" ON "webhook_queue" ("webhook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_status" ON "webhook_queue" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_next_retry" ON "webhook_queue" ("next_retry_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "failed_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "payload" jsonb NOT NULL,
  "error_message" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_failed_webhooks_tenant" ON "failed_webhooks" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_failed_webhooks_webhook" ON "failed_webhooks" ("webhook_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "priority" text NOT NULL DEFAULT 'medium',
  "category" text DEFAULT 'general',
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid,
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_tenant" ON "support_tickets" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_contact" ON "support_tickets" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_assigned" ON "support_tickets" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_status" ON "support_tickets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_tenant_status" ON "support_tickets" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_metadata_g" ON "support_tickets" USING gin ("metadata");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_active" ON "support_tickets" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "is_internal" boolean DEFAULT false,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ticket_replies_tenant" ON "ticket_replies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ticket_replies_ticket" ON "ticket_replies" ("ticket_id");

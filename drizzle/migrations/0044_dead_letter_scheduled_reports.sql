CREATE TABLE IF NOT EXISTS "dead_letter_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "job_type" text NOT NULL,
  "job_id" text,
  "queue" text NOT NULL,
  "payload" jsonb NOT NULL,
  "error_message" text NOT NULL,
  "error_stack" text,
  "attempts" integer DEFAULT 0,
  "max_attempts" integer DEFAULT 3,
  "status" text NOT NULL DEFAULT 'pending',
  "original_run_at" timestamp with time zone,
  "failed_at" timestamp with time zone DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id"),
  "resolution" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_letter_queue_tenant" ON "dead_letter_queue" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_letter_status" ON "dead_letter_queue" ("status", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_letter_job_type" ON "dead_letter_queue" ("job_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_letter_created" ON "dead_letter_queue" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "frequency" text NOT NULL,
  "recipients" jsonb DEFAULT '[]'::jsonb,
  "config" jsonb DEFAULT '{}'::jsonb,
  "format" text DEFAULT 'pdf',
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_tenant" ON "scheduled_reports" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_status" ON "scheduled_reports" ("status", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_next_run" ON "scheduled_reports" ("next_run_at");

CREATE TABLE IF NOT EXISTS "sequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft',
  "enroll_count" integer DEFAULT 0,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequences_tenant" ON "sequences" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequences_metadata_g" ON "sequences" USING gin ("metadata");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequences_active" ON "sequences" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sequence_id" uuid NOT NULL REFERENCES "sequences"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "step_number" integer NOT NULL,
  "step_type" text NOT NULL DEFAULT 'email',
  "delay_days" integer DEFAULT 0,
  "delay_hours" integer DEFAULT 0,
  "delay_minutes" integer DEFAULT 0,
  "template_id" uuid,
  "content" text,
  "subject" text,
  "body" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequence_steps_seq" ON "sequence_steps" ("sequence_id", "step_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequence_steps_tenant" ON "sequence_steps" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_id" uuid NOT NULL REFERENCES "sequences"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'active',
  "current_step" integer NOT NULL DEFAULT 1,
  "next_step_at" timestamp with time zone,
  "enrolled_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seq_enrollments_tenant" ON "sequence_enrollments" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seq_enroll_contact" ON "sequence_enrollments" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seq_enroll_seq" ON "sequence_enrollments" ("sequence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seq_enroll_status" ON "sequence_enrollments" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seq_enrollments_metadata_g" ON "sequence_enrollments" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_step_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enrollment_id" uuid NOT NULL REFERENCES "sequence_enrollments"("id") ON DELETE CASCADE,
  "step_id" uuid REFERENCES "sequence_steps"("id") ON DELETE SET NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "scheduled_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequence_step_logs_enrollment" ON "sequence_step_logs" ("enrollment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequence_step_logs_scheduled" ON "sequence_step_logs" ("scheduled_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sequence_step_logs_tenant" ON "sequence_step_logs" ("tenant_id");

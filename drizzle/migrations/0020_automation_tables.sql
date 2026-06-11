-- Migration: Automation group tables (dead_letter_queue, scheduled_reports, assignment_logs, assignment_rules)

CREATE TABLE IF NOT EXISTS "dead_letter_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"job_id" text,
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error_message" text NOT NULL,
	"error_stack" text,
	"attempts" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"status" text DEFAULT 'pending' NOT NULL,
	"original_run_at" timestamp with time zone,
	"failed_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"frequency" text NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"format" text DEFAULT 'pdf',
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);

CREATE TABLE IF NOT EXISTS "assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"entity_type" text DEFAULT 'lead' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "assignment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"assigned_to" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dead_letter_queue_resolved_by_users_id_fk') THEN
    ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_updated_by_users_id_fk') THEN
    ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_deleted_by_users_id_fk') THEN
    ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_dead_letter_queue_tenant" ON "dead_letter_queue" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dead_letter_status" ON "dead_letter_queue" USING btree ("status","tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dead_letter_job_type" ON "dead_letter_queue" USING btree ("job_type");
CREATE INDEX IF NOT EXISTS "idx_dead_letter_created" ON "dead_letter_queue" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_tenant" ON "scheduled_reports" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_status" ON "scheduled_reports" USING btree ("status","tenant_id");
CREATE INDEX IF NOT EXISTS "idx_scheduled_reports_next_run" ON "scheduled_reports" USING btree ("next_run_at");
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_tenant" ON "assignment_logs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_rule" ON "assignment_logs" USING btree ("tenant_id","rule_id");
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_entity" ON "assignment_logs" USING btree ("tenant_id","entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_assignee" ON "assignment_logs" USING btree ("tenant_id","assigned_to");
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_tenant" ON "assignment_rules" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_type" ON "assignment_rules" USING btree ("tenant_id","type");
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_active" ON "assignment_rules" USING btree ("tenant_id","is_active");

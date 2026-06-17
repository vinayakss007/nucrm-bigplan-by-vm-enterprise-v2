CREATE TABLE IF NOT EXISTS "follow_ups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid,
  "contact_id" uuid,
  "deal_id" uuid,
  "assigned_to" uuid,
  "title" text NOT NULL,
  "description" text,
  "due_date" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "missed_days" integer DEFAULT 0,
  "auto_ai_enabled" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_tenant" ON "follow_ups" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_assigned" ON "follow_ups" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_due_date" ON "follow_ups" ("due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_status" ON "follow_ups" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_lead" ON "follow_ups" ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_contact" ON "follow_ups" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_deal" ON "follow_ups" ("deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_follow_ups_active" ON "follow_ups" ("id") WHERE "deleted_at" IS NULL;

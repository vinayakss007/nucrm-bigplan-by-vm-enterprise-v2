CREATE TABLE IF NOT EXISTS "assignment_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 0,
  "entity_type" text NOT NULL DEFAULT 'lead',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_tenant" ON "assignment_rules" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_type" ON "assignment_rules" ("tenant_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_rules_active" ON "assignment_rules" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignment_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "rule_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "assigned_to" text NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_tenant" ON "assignment_logs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_rule" ON "assignment_logs" ("tenant_id", "rule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_entity" ON "assignment_logs" ("tenant_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assignment_logs_assignee" ON "assignment_logs" ("tenant_id", "assigned_to");

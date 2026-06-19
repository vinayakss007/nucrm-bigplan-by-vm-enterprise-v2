CREATE TABLE IF NOT EXISTS "sla_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "priority" text NOT NULL,
  "response_time_minutes" integer NOT NULL,
  "resolution_time_minutes" integer NOT NULL,
  "escalation_rules" jsonb DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_policies_tenant" ON "sla_policies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_policies_priority" ON "sla_policies" ("tenant_id", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_policies_active" ON "sla_policies" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sla_breaches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "policy_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "breach_type" text NOT NULL,
  "breached_at" timestamp with time zone NOT NULL,
  "notified_users" jsonb DEFAULT '[]'::jsonb,
  "escalation_level" integer DEFAULT 0,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_tenant" ON "sla_breaches" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_policy" ON "sla_breaches" ("tenant_id", "policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_entity" ON "sla_breaches" ("tenant_id", "entity_type", "entity_id");

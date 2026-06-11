-- Migration: SLA group tables (sla_policies, sla_breaches)

CREATE TABLE IF NOT EXISTS "sla_breaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"breach_type" text NOT NULL,
	"breached_at" timestamp with time zone NOT NULL,
	"notified_users" jsonb DEFAULT '[]'::jsonb,
	"escalation_level" integer DEFAULT 0,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"response_time_minutes" integer NOT NULL,
	"resolution_time_minutes" integer NOT NULL,
	"escalation_rules" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_tenant" ON "sla_breaches" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_policy" ON "sla_breaches" USING btree ("tenant_id","policy_id");
CREATE INDEX IF NOT EXISTS "idx_sla_breaches_entity" ON "sla_breaches" USING btree ("tenant_id","entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "idx_sla_policies_tenant" ON "sla_policies" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sla_policies_priority" ON "sla_policies" USING btree ("tenant_id","priority");
CREATE INDEX IF NOT EXISTS "idx_sla_policies_active" ON "sla_policies" USING btree ("tenant_id","is_active");

-- Migration: Compliance group tables (compliance_requests, data_retention_policies)

CREATE TABLE IF NOT EXISTS "compliance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "data_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"retention_days" integer NOT NULL,
	"action" text DEFAULT 'archive' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_executed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_tenant" ON "compliance_requests" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_type" ON "compliance_requests" USING btree ("tenant_id","type");
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_status" ON "compliance_requests" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_data_retention_policies_tenant" ON "data_retention_policies" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_data_retention_entity" ON "data_retention_policies" USING btree ("tenant_id","entity_type");

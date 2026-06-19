CREATE TABLE IF NOT EXISTS "compliance_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" uuid NOT NULL,
  "completed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "result" jsonb DEFAULT '{}'::jsonb,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_tenant" ON "compliance_requests" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_type" ON "compliance_requests" ("tenant_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_requests_status" ON "compliance_requests" ("tenant_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "retention_days" integer NOT NULL,
  "action" text NOT NULL DEFAULT 'archive',
  "is_active" boolean NOT NULL DEFAULT true,
  "last_executed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_data_retention_tenant" ON "data_retention_policies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_data_retention_entity" ON "data_retention_policies" ("tenant_id", "entity_type");

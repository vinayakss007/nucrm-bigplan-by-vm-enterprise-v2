CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "rule_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rejected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_approval_requests_tenant" ON "approval_requests" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_entity" ON "approval_requests" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_status" ON "approval_requests" ("tenant_id", "status");

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0148: persisted approval rules (#2597 A3).
--
-- `approval_requests.rule_id` is a text id naming a rule that had no table and
-- no writer. /api/tenant/rbac/approval-rules answered the settings tab with a
-- hardcoded `[]`, so an admin could never create the first rule and the empty
-- state was indistinguishable from an unimplemented feature. This table is the
-- storage half of A3: it gives that route something real to read and write.
-- Wiring checkNeedsApproval -> requestApproval into mutating entity handlers is
-- deliberately a follow-up (it changes when a CRM write takes effect).
--
-- Tenant-scoped: FORCE RLS with the fail-closed tenant_isolation policy (0039
-- shape). All indexes are CONCURRENTLY (#3301 / check-migration-chain): a plain
-- CREATE INDEX would hold SHARE across the whole pending-backlog transaction.
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS on every statement.

CREATE TABLE IF NOT EXISTS "approval_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "entity_type" text NOT NULL,
  "condition_field" text NOT NULL,
  "condition_operator" text NOT NULL DEFAULT '>=',
  "condition_value" text NOT NULL,
  "approver_role_slug" text NOT NULL,
  "auto_approve_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_approval_rules_tenant" ON "approval_rules" ("tenant_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_approval_rules_entity" ON "approval_rules" ("tenant_id", "entity_type");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_approval_rules_unique_live" ON "approval_rules" ("tenant_id", "name") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "approval_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "approval_rules";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_rules"
  FOR ALL
  USING (
    tenant_id IS NULL
    OR tenant_id = (
      CASE
        WHEN NULLIF(current_setting('app.current_tenant', true), '') IS NULL THEN NULL
        ELSE NULLIF(current_setting('app.current_tenant', true), '')::uuid
      END
    )
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = (
      CASE
        WHEN NULLIF(current_setting('app.current_tenant', true), '') IS NULL THEN NULL
        ELSE NULLIF(current_setting('app.current_tenant', true), '')::uuid
      END
    )
  );

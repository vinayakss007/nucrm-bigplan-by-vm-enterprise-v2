-- 0147: superadmin SELECT on audit_logs so chain verification can see every tenant (#3577).
--
-- `audit_logs` has exactly one policy, `tenant_isolation` (0015, fail-closed in
-- 0039): `tenant_id IS NULL OR tenant_id = app.current_tenant::uuid`. It has no
-- `app.is_super_admin` branch, while requireAuth() sets app.current_tenant to
-- the admin's own tenant (or the nil sentinel) alongside app.is_super_admin=true.
-- A platform superadmin therefore reads at most their own tenant's audit rows —
-- usually none — so /api/system/audit-verify checked zero tenants and returned
-- `chain_valid: true` from an empty `every()`, and verifyAuditChain() returned
-- `valid: true` for a tenant whose rows it could not see.
--
-- This adds a SELECT-only superadmin policy using the same GUC pattern as 0090's
-- backup-table bypass. It is additive to tenant_isolation (Postgres ORs
-- permissive policies), so ordinary tenant requests — which never carry
-- app.is_super_admin=true — keep exactly the isolation they had. No write path
-- changes: audit_logs is append-only with immutability triggers (0042).
--
-- Idempotent: DROP IF EXISTS before CREATE, safe to re-run.

DROP POLICY IF EXISTS "audit_logs_super_admin_read" ON "audit_logs";
--> statement-breakpoint
CREATE POLICY "audit_logs_super_admin_read" ON "audit_logs" FOR SELECT
  USING ((NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true));
--> statement-breakpoint
-- Prove the policy was created and is SELECT-only; a partially applied migration
-- must fail rather than ship a monitor that still verifies nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class t ON p.polrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'audit_logs'
      AND p.polname = 'audit_logs_super_admin_read'
      AND p.polcmd = 'r'
  ) THEN
    RAISE EXCEPTION '0147: audit_logs_super_admin_read SELECT policy was not created';
  END IF;
END $$;

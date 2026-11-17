-- 0147 rollback: remove the superadmin SELECT policy on audit_logs.
--
-- 0147 only added a permissive SELECT policy; the pre-existing
-- `tenant_isolation` policy is untouched, so dropping this one restores the
-- exact read surface audit_logs had before. Safe to re-run.

DROP POLICY IF EXISTS "audit_logs_super_admin_read" ON "audit_logs";

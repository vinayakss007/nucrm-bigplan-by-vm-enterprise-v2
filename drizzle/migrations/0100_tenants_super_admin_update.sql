-- 0100: super-admin UPDATE escape for tenants.
--
-- The panel's own writes (suspend/resume, trial expiry, plan/module/limit
-- changes) run with the platform GUC. `tenants` had no UPDATE path that such a
-- connection can satisfy: its only UPDATE-usable USING clause is
-- tenants_authenticated_update, which asks for a non-empty app.current_user,
-- and the two FOR ALL policies carry WITH CHECK only (they cannot make a row
-- visible to an UPDATE). Measured on preprod, rolled back, no rows touched:
--
--   app.is_super_admin only ......... UPDATE ... rowCount = 0   (silent)
--   app.is_super_admin + current_user UPDATE ... rowCount = 1
--
-- The zero is the dangerous part: Postgres reports no error, so every job that
-- expires or suspends a tenant logged success while changing nothing. Trials
-- never ended, and check-overdue-invoices / subscription-sync /
-- billing-reconciliation / update-tenant-limits all "ran clean" for nothing.
--
-- This is permissive, so it is ORed with the existing policies: a scoped
-- request still needs its own app.current_tenant/app.current_user, and nothing
-- about tenant-facing behaviour changes. It deliberately grants UPDATE only.
-- There is still NO DELETE policy on tenants — the cutoff for a non-paying
-- tenant is suspension, never deletion.
DO $$
BEGIN
  DROP POLICY IF EXISTS "tenants_super_admin_update" ON "tenants";
  CREATE POLICY "tenants_super_admin_update" ON "tenants"
    AS PERMISSIVE
    FOR UPDATE
    USING (((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true))
    WITH CHECK (true);
END $$;

-- 0100 down: remove the platform UPDATE escape, restoring the fail-closed state
-- where a tenants write requires an acting app.current_user.
DO $$
BEGIN
  DROP POLICY IF EXISTS "tenants_super_admin_update" ON "tenants";
END $$;

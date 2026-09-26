-- 0089 down: restore pre-existing users SELECT visibility (self + super admin).
DROP POLICY IF EXISTS "users_tenant_member_read" ON "users";

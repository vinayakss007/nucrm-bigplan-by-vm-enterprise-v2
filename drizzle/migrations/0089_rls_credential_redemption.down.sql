-- Down migration for 0089: drop the credential-redemption policies.
--
-- Purely additive migration — the rollback only has to remove what it added.
-- 0088's own policies (sessions_user_own, password_resets_user_own,
-- email_verifications_user_own, tenant_isolation, ...) are left untouched, so
-- reverting restores 0088's exact behaviour.
DROP POLICY IF EXISTS "sessions_auth_lookup" ON "sessions";
DROP POLICY IF EXISTS "sessions_security" ON "sessions";
DROP POLICY IF EXISTS "password_resets_auth_insert" ON "password_resets";
DROP POLICY IF EXISTS "password_resets_auth_select" ON "password_resets";
DROP POLICY IF EXISTS "password_resets_security" ON "password_resets";
DROP POLICY IF EXISTS "email_verifications_auth_insert" ON "email_verifications";
DROP POLICY IF EXISTS "email_verifications_auth_select" ON "email_verifications";
DROP POLICY IF EXISTS "email_verifications_security" ON "email_verifications";
DROP POLICY IF EXISTS "tenant_members_user_own" ON "tenant_members";
DROP POLICY IF EXISTS "roles_member_read" ON "roles";

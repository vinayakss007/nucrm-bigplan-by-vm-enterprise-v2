/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0127: the membership self-read that workspace resolution needs (#2626).
--
-- requireAuth resolves WHO the caller is before it can know WHICH workspace
-- to scope to — and that resolution is itself a read of two tenant-scoped
-- tables. lib/auth/middleware.ts runs the membership join inside
-- withUserContext(payload.userId), which sets app.current_user and nothing
-- else (lib/db/rls.ts). tenant_members and roles each carry only
-- `tenant_isolation` (FOR ALL), whose USING clause compares tenant_id to
-- app.current_tenant — a value the caller cannot supply because finding it
-- is the point of the query. Under fail-closed deparse the join matches zero
-- rows, so `loaded.member` is null and every non-super-admin session on a
-- fresh database 403s "No active workspace". Measured on the dev host:
-- login succeeds, the very next authenticated request is a 403, forever.
--
-- Granted the way 0122 granted the portal credential read and 0089 granted
-- users_tenant_member_read: SELECT only, keyed on app.current_user — a
-- credential the auth path already sets for every session redemption — and
-- nothing else.
--
-- Deliberately NOT app.is_super_admin (#2253: one SET flips 60 policies
-- across 49 tables fail-open) and NOT app.current_tenant (the workspace is
-- what this read is looking for; naming it in advance would admit an
-- arbitrary tenant's full membership list to a caller who has proved only
-- its password).
--
--   * tenant_members_self_read — a user sees their OWN active membership
--     rows, which is exactly the set the join's ON clause filters to anyway.
--     Inactive memberships stay invisible, so a revoked member cannot even
--     observe their old row.
--   * roles_tenant_member_read — a user sees the roles of tenants they are
--     an active member of. It references tenant_members, never roles, so
--     the policy is stable (no recursion into itself — the failure class
--     documented in docs/agent-plans/codebugs-verified/DB-RLS-ISSUES.md).
--     COALESCE(roles.permissions) in the auth join deposes to '{}' without
--     it, which would silently strip every member's permissions.
--
-- Written as drop-then-create DO blocks (0100/0105/0122's shape) with the
-- exact policy names already applied by hand on the dev database, so a host
-- carrying the #2626 hotpatch converges to the same state as a fresh one
-- instead of aborting on duplicate objects.

DO $$
BEGIN
  DROP POLICY IF EXISTS "tenant_members_self_read" ON "tenant_members";
  CREATE POLICY "tenant_members_self_read" ON "tenant_members"
    AS PERMISSIVE
    FOR SELECT
    USING (
      status = 'active'
      AND user_id = (NULLIF(current_setting('app.current_user', true), ''))::uuid
    );

  DROP POLICY IF EXISTS "roles_tenant_member_read" ON "roles";
  CREATE POLICY "roles_tenant_member_read" ON "roles"
    AS PERMISSIVE
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM tenant_members tm
        WHERE tm.tenant_id = roles.tenant_id
          AND tm.user_id = (NULLIF(current_setting('app.current_user', true), ''))::uuid
          AND tm.status = 'active'
      )
    );
END $$;

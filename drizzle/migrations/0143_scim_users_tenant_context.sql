/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0143: the workspace directory a SCIM bearer token is entitled to read and update (#3303).
--
-- `GET /api/scim/v2/Users` and `PATCH`/`DELETE /api/scim/v2/Users/:id` authenticate
-- with `verifySCIMToken` (lib/scim/index.ts): an HMAC over `tenantId:expiry` that
-- names the workspace and sets no `app.*` GUC. Every statement behind it ran on the
-- bare pool, and `users` (0088:60 FORCE RLS) has three SELECT arms and one UPDATE
-- arm, none of which a machine token with no acting user satisfies:
--   users_read_self          keys on `app.current_user` = id
--   users_tenant_member_read keys on `app.current_user` sharing an active membership
--   users_super_admin_read   keys on `app.is_super_admin`
--   users_update_own         same `app.current_user` predicate
-- Measured on the dev database as `nucrm_app`, inside `begin … rollback`:
--   the list query with no context                -> 0 rows (today's empty directory)
--   this arm, no GUC / GUC = ''                   -> 0 rows (the reset value denies)
--   this arm, GUC = the token's tenant, user in it -> 1 row, and only members of it
--   this arm, GUC = tenant B, user only in A      -> 0 rows: the claim cannot widen
--   this arm alone, UPDATE another tenant's user  -> the row unchanged: the UPDATE
--                                                   arm's USING is the same membership
--   this arm alone, INSERT users                  -> still users_insert_auth's call
--
-- WHY A DEDICATED GUC
-- -------------------
-- `users` is shared across workspaces (membership lives in tenant_members), so an arm
-- keyed on `app.current_tenant` would hand the directory to every body that already
-- sets a tenant context — including the anonymous public routes (#3163). `app.scim_tenant`
-- is set by `withScimTenantContext` (lib/db/scim-context.ts), added to both reset lists in
-- lib/db/pool.ts and lib/db/request-connection.ts, and cleared on checkout like the rest.
--
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------
-- No arm on `sessions`, `refresh_tokens` or `tenant_members`. SCIM's two cross-tenant
-- questions — "does this user work elsewhere" and "revoke their sessions" — are answered
-- through the user's own identity by 0127/0088 policies (`tenant_members_self_read`,
-- `sessions_user_own`), inside `withScimUserIdentity`; an arm keyed on a tenant here would
-- either be blind to the other tenancies or widen the tenant surface for exactly that.
--
-- Lands UNAPPLIED on production: applying migrations is the owner's deploy step (PP-057's
-- backlog, PP-060's missing apply path). Written as a DO block, the way 0133-0142 are, so
-- a hand-apply and a `db:migrate` replay are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "users_tenant_scim_read" ON "users";
  CREATE POLICY "users_tenant_scim_read" ON "users"
    AS PERMISSIVE
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM tenant_members tm
        WHERE tm.user_id = users.id
          AND tm.status = 'active'
          AND tm.tenant_id = NULLIF(current_setting('app.scim_tenant', true), '')::uuid
      )
    );

  DROP POLICY IF EXISTS "users_tenant_scim_update" ON "users";
  CREATE POLICY "users_tenant_scim_update" ON "users"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM tenant_members tm
        WHERE tm.user_id = users.id
          AND tm.status = 'active'
          AND tm.tenant_id = NULLIF(current_setting('app.scim_tenant', true), '')::uuid
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM tenant_members tm
        WHERE tm.user_id = users.id
          AND tm.status = 'active'
          AND tm.tenant_id = NULLIF(current_setting('app.scim_tenant', true), '')::uuid
      )
    );
END $$;

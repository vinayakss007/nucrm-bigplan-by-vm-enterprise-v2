/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0136: let the OAuth token endpoint authenticate a client and mint a token (#3225)
--
-- 0134/0135 made password_resets, email_verifications and oauth_codes redeemable by
-- an application role that is not a superuser. `POST /api/auth/oauth/token` was left
-- out, and it is broken in three places — found by
-- tests/integration/pre-auth-route-redemption-rls-3222.test.ts, which drives the real
-- handler over a NOSUPERUSER / NOBYPASSRLS probe role.
--
-- Measured on the local force-RLS dev database (role `nucrm_app`, rolbypassrls = f,
-- relforcerowsecurity = t on oauth_clients / oauth_codes / oauth_tokens), with a
-- fixture tenant, user, active client and one live token pair:
--
--   SELECT count(*) FROM oauth_clients WHERE client_id = <presented> AND is_active
--     no context                        -> 0 rows   <- what the route actually sends
--     app.auth_lookup = 'true'          -> 0 rows   (0134/0135 never touched this table)
--     app.current_tenant = own tenant   -> 1 row    (proof: it is 0088's tenant_isolation)
--
--   INSERT INTO oauth_tokens … (access/refresh/user_id/expires_at all set)
--     no context                        -> 42501 new row violates row-level security policy
--     app.token_issue + app.token_credential
--                                       -> 42501   (the redemption tx's own context)
--     app.current_user = <user_id>      -> succeeds
--
--   DELETE FROM oauth_tokens WHERE refresh_token = <presented> AND client_id = … AND
--         expires_at > now() RETURNING id
--     no context                        -> rowCount 0, and the owner still reads the row
--     app.current_user = <its owner>    -> deletes it, RETURNING works
--
-- So every grant the endpoint serves dies at its first statement: a correct client id
-- and a correct secret answer `401 invalid_client`, and the refresh rotation is the
-- same silent zero-row write #3102 shipped for reset tokens — the handler reads the
-- empty read-back as `invalid_grant` while the presented refresh token stays valid
-- forever, which is the opposite of rotation and un-enforces #3075's replay defence
-- here.
--
-- WHY THE USER-CONTEXT ROUTE WAS NOT TAKEN
-- -----------------------------------------
-- The third and fifth measurements above show `oauth_tokens_user_own` already covering
-- INSERT (and DELETE, and RETURNING) once `app.current_user` is set — an ALL policy
-- with no WITH CHECK reuses its USING clause as the check. The route could therefore
-- be fixed with `setUserContext(userId, tx)`. It was not, for two reasons:
--
--  * the refresh path cannot name the user before it has read the row the delete is
--    about — the same chicken-and-egg 0135 solved for password_resets by adding a
--    claim-context read arm keyed on the presented credential; and
--  * app.current_user is not a narrow privilege. It opens every `*_own` policy in the
--    schema (contacts, deals, notes, sessions, …) for the whole transaction, on a
--    request that has authenticated a *client*, not a person. #2253 counted one SET
--    flipping 60 policies across 49 tables; this is the same shape of mistake with a
--    different GUC in front of it.
--
-- So the endpoint gets grants of the shape 0135 uses: a privilege flag plus the one
-- value the statement is matching, and nothing else.
--
-- WHAT THIS INSTALLS
-- -------------------
--  * oauth_clients_client_lookup (SELECT) — `app.auth_lookup` (already the "this is a
--    pre-auth identity lookup" flag, already SELECT-only, 0088/0099) and
--    `client_id = current_setting('app.oauth_client_id', true)` — a NEW GUC. It is not
--    `app.token_credential`: that slot carries bearer material (a token hash, a code),
--    and a client id is a public identifier the caller has just written in a form
--    field. Conflating them would let a context opened for one credential satisfy the
--    other table's arm, and it would put a non-secret in a slot whose clearing rules
--    are written for secrets. The equality is the narrowing: an arm gated on
--    `app.auth_lookup` alone would hand every pre-auth request the `client_secret` of
--    every registered client, which is exactly the widening #3218 removed.
--  * oauth_tokens_token_issue (INSERT) — `app.token_issue` + a non-null user + a future
--    expiry, mirroring 0134's `oauth_codes_token_issue`. The grant cannot plant a row
--    for nobody or one that is already dead.
--  * oauth_tokens_refresh_claim (DELETE) — `app.token_issue` and
--    `refresh_token = current_setting('app.token_credential', true)`, live rows only.
--    This is the rotation's claim; the credential is the presented refresh token.
--  * oauth_tokens_refresh_claim_read (SELECT) — the same predicate. A DELETE is gated
--    by the table's SELECT policies like an UPDATE is, and its RETURNING output is
--    filtered by them too (0135's header has that measurement); without this arm the
--    claim below matches nothing and `DELETE … RETURNING user_id, scope` yields the
--    empty read-back that this whole file exists to remove.
--
-- `app.oauth_client_id` therefore joins BOTH connection-reset lists
-- (`lib/db/pool.ts`, `lib/db/request-connection.ts`) alongside `app.token_credential`:
-- #2446's failure mode is a privilege GUC surviving a pool checkout into an unrelated
-- request, and this one selects which client's secret row is readable.
--
-- Not touched, deliberately: `oauth_clients.tenant_isolation` stays exactly as 0088
-- wrote it, so client-management routes keep their tenant scoping; `GET
-- /api/auth/oauth/authorize` runs under `requireAuth`, gets a tenant context from the
-- middleware, and reaches its own client row through that — whether a *cross-tenant*
-- client should be authorisable there is a separate question (#3225 does not answer
-- it) and this file neither helps nor hurts it.
--
-- Written as a DO block (0100/0105/0122/0133/0134/0135's shape), so applying it by
-- hand and having db:migrate replay it are the same no-op.

DO $$
BEGIN
  -- ── oauth_clients ────────────────────────────────────────────────

  DROP POLICY IF EXISTS "oauth_clients_client_lookup" ON "oauth_clients";
  CREATE POLICY "oauth_clients_client_lookup" ON "oauth_clients"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND "client_id" = current_setting('app.oauth_client_id', true)
    );

  -- ── oauth_tokens ─────────────────────────────────────────────────

  DROP POLICY IF EXISTS "oauth_tokens_token_issue" ON "oauth_tokens";
  CREATE POLICY "oauth_tokens_token_issue" ON "oauth_tokens"
    AS PERMISSIVE
    FOR INSERT
    WITH CHECK (
      (current_setting('app.token_issue', true))::text = 'true'
      AND user_id IS NOT NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_tokens_refresh_claim_read" ON "oauth_tokens";
  CREATE POLICY "oauth_tokens_refresh_claim_read" ON "oauth_tokens"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "refresh_token" = current_setting('app.token_credential', true)
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_tokens_refresh_claim" ON "oauth_tokens";
  CREATE POLICY "oauth_tokens_refresh_claim" ON "oauth_tokens"
    AS PERMISSIVE
    FOR DELETE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "refresh_token" = current_setting('app.token_credential', true)
      AND expires_at > now()
    );
END $$;

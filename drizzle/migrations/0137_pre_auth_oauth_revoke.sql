/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0137: give POST /api/auth/oauth/revoke a policy that can retire a token it is named (#3231)
--
-- 0136 (#3225) installed the client-lookup and refresh-claim arms that let the token
-- endpoint authenticate a client and rotate a token. `oauth_tokens` was left with no
-- arm that matches on `access_token` at all, and `POST /api/auth/oauth/revoke` — the
-- sibling endpoint, RFC 7009 — needs exactly that. Found by measuring the route the
-- same way #3222/#3225 measured `/token`, as a NOSUPERUSER / NOBYPASSRLS role against
-- the force-RLS dev database with a fixture tenant, user, active client and one live
-- token pair:
--
--   SELECT id, client_secret FROM oauth_clients WHERE client_id = <presented>   (revoke/route.ts:40)
--     no context                        -> 0 rows   <- what the route actually sends
--     app.auth_lookup + app.oauth_client_id
--                                       -> 1 row    (0136's arm, unused by this route)
--
--   DELETE FROM oauth_tokens WHERE refresh_token = <presented> AND client_id = <own>
--     no context                        -> claimed 0, and after a COMMITTED delete the
--                                          owner still reads the row back: 1
--     app.token_issue + app.token_credential = <presented>
--                                       -> claimed 1  (0136's claim arms already cover it)
--
--   DELETE FROM oauth_tokens WHERE access_token = <presented> AND client_id = <own>
--     no context                        -> claimed 0
--     app.token_issue + app.token_credential = <presented>
--                                       -> claimed 0   <- THIS is what 0137 adds
--     … and after this file             -> claimed 1
--
-- So `/revoke` dies at its first statement like `/token` did — a correct client id and
-- a correct secret answer `401 invalid_client` — and even once that read is bound, its
-- refresh-hint path is the silent zero-row write #3075 and #3102 exist to prevent: the
-- handler takes `result.rowCount || 0`, sees 0, and answers `{"ok":true,"revoked":false}`
-- over a token that is still live and still mints access tokens. The access-hint path
-- cannot be fixed by any context the route could set: there is nothing to set *into*.
-- `token_type_hint=access_token` and the no-hint branch (which deletes by refresh and by
-- access in parallel, `route.ts:90-103`) therefore have never revoked an access token
-- under enforced RLS, and `expires_at` is the only thing that retires one.
--
-- WHAT THIS INSTALLS
-- -------------------
--  * oauth_tokens_access_claim (DELETE) and oauth_tokens_access_claim_read (SELECT) —
--    the exact shape of 0136's refresh pair with the other column named:
--    `app.token_issue` and `access_token = current_setting('app.token_credential', true)`,
--    live rows only. `app.token_credential` is the right slot here and not a new GUC: an
--    access token IS bearer material, unlike #3225's client id, which is why that one got
--    its own GUC instead of sharing this slot.
--  * The read arm for the same reason 0136 needed one: a DELETE is gated by the table's
--    SELECT policies like an UPDATE is, and its RETURNING is filtered by them (0135's
--    header carries that measurement). Without it the claim below matches nothing.
--
-- WHY BOTH ARMS CAN BE OPEN AT ONCE
-- ----------------------------------
-- The no-hint branch presents one opaque string and tries both columns. `setTokenIssueContext`
-- puts that string in `app.token_credential`, so the refresh arm matches it against
-- `refresh_token` and this arm against `access_token`; whichever column the presented
-- value actually lives in admits the row and the other claims zero. A non-matching claim
-- is a `DELETE 0`, not an error — measured above — because DELETE has no WITH CHECK, only
-- the USING filter that decides which rows are visible to be deleted. So one context serves
-- the whole branch and neither arm widens the other: each still names exactly one value.
--
-- Not touched, deliberately: an expired row is still not revocable. The live-only
-- predicate mirrors 0136's rotation claim, and an expired token is already unusable, so a
-- claim on it buys nothing and an arm that admitted dead rows would let a presented string
-- reach the whole history of a client's grants.
--
-- Written as a DO block (0100/0105/0122/0133/0134/0135/0136's shape), so applying it by
-- hand and having db:migrate replay it are the same no-op.

DO $$
BEGIN
  DROP POLICY IF EXISTS "oauth_tokens_access_claim" ON "oauth_tokens";
  CREATE POLICY "oauth_tokens_access_claim" ON "oauth_tokens"
    AS PERMISSIVE
    FOR DELETE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "access_token" = current_setting('app.token_credential', true)
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_tokens_access_claim_read" ON "oauth_tokens";
  CREATE POLICY "oauth_tokens_access_claim_read" ON "oauth_tokens"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "access_token" = current_setting('app.token_credential', true)
      AND expires_at > now()
    );
END $$;

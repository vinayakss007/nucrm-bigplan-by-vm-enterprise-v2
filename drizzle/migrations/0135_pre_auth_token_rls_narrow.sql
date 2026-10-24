/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0135: name the credential in the pre-auth redemption policies (#3218, #3102)
--
-- 0134 says of its SELECT arm: "USING admits exactly the row the caller is looking
-- for: matching token hash, not yet consumed, not expired." It does not: there is
-- no token predicate in it, and `app.auth_lookup` is a boolean — it says *what
-- kind of request this is*, never *which credential*. So any pre-auth read that
-- turns the lookup GUC on sees every live row of three secret-bearing tables, and
-- the one injected `WHERE` that the policies exist to survive is enough to
-- enumerate other users' reset tokens, verification tokens and OAuth codes.
--
-- Measured on the local force-RLS dev database with 0134 applied, as the
-- application role (`nucrm_app`, rolbypassrls = false, relforcerowsecurity = true):
--
--   auth_lookup = 'true', no credential   -> SELECT count(*) FROM password_resets
--                                             sees every live row (3 of 3 fixtures)
--
-- The repo already has the right shape: `app.portal_lookup_token`,
-- `app.portal_lookup_email` and `app.form_lookup_id` name the bearer credential
-- the query is matching, and the policy compares against them (0102-era, and
-- `lib/db/request-connection.ts` says why in so many words). This does the same
-- for pre-auth redemption with `app.token_credential`.
--
-- WHAT ELSE MEASUREMENT TURNED UP, and why this file is not just six WHERE clauses
-- --------------------------------------------------------------------------------
-- A row-level security UPDATE is gated by the table's SELECT policies as well as
-- by its own: a row the role cannot see cannot be updated, and the *new* image has
-- to stay visible too or the statement raises 42501. Both halves were measured
-- against 0134 on the real tables:
--
--   UPDATE password_resets SET deleted_at = now()
--     WHERE token = <the token being redeemed> AND deleted_at IS NULL …
--     RETURNING id, user_id
--   … in a transaction with app.token_issue = 'true' and no app.auth_lookup:
--       rowCount = 0, and the row is genuinely NOT consumed (deleted_at still NULL).
--
--   UPDATE password_resets SET deleted_at = now() WHERE user_id = … AND deleted_at IS NULL
--   … same context: rowCount = 0, three live tokens left live.
--
-- 0134's only SELECT arm on those tables is gated on app.auth_lookup, which the
-- claim transactions never set. So the redemption path #3102 exists for still
-- fails: reset-password / verify-email / oauth-token take the empty read-back as
-- "invalid or expired token" and answer 400/404 — and #3075's one-live-token rule
-- is silently not enforced either. Narrowing alone would not have fixed that, so
-- each table gets a claim-context read arm as well, and password_resets gets a
-- retire pair for the by-user invalidation. A claim cannot use 0134's lookup arm
-- for this: it requires `deleted_at IS NULL`, and the row the claim has just
-- written has deleted_at set — that combination was measured to raise
-- `new row violates row-level security policy`.
--
-- A third measurement, kept here because it is the constraint the next writer
-- will hit: `RETURNING` output is filtered by the table's SELECT policies. An
-- `INSERT … RETURNING` under app.token_issue alone raises 42501 — the new row is
-- written, then refused on the way back to the client, and the statement rolls
-- back. No issuance site does this today (forgot-password and the registration
-- flow insert without reading back), so nothing is broken by it; if one ever
-- wants the row, it names the credential it just minted, which is exactly what
-- T_token_claim_read below admits. tests/integration/
-- pre-auth-token-rls-credential-3218.test.ts pins both halves.
--
-- Per table T with credential column C (password_resets.token,
-- email_verifications.token_hash, oauth_codes.code):
--  * T_auth_lookup (SELECT)            — 0134's arm plus `C = app.token_credential`.
--    Freshness flags stay; nothing is written in this context, so they cost nothing.
--  * T_token_claim_read (SELECT)       — NEW. `app.token_issue = 'true'` and
--    `C = app.token_credential`, no freshness condition: it has to admit the row
--    both before and after the tombstone, and it still names exactly one row.
--  * T_token_claim (UPDATE)            — 0134's arm plus the same credential
--    equality in USING. WITH CHECK is untouched, as #3218 asks.
--  * T_token_issue (INSERT)            — untouched. An INSERT has no pre-existing
--    row to hide, and its WITH CHECK already refuses a null user and a past expiry.
--
-- password_resets additionally gets:
--
--  * password_resets_token_retire (UPDATE)          — `app.token_retire_user` names
--    the user whose outstanding tokens are being retired; USING keeps the liveness
--    test, WITH CHECK requires the tombstone and the same user, so the grant cannot
--    touch another user's row or move anything else.
--  * password_resets_token_retire_read (SELECT)     — that user's rows, no liveness,
--    for the same before/after-image reason. It discloses one-way SHA-256 hashes
--    and timestamps of rows the context is already authorised to tombstone; the
--    raw tokens are never stored (#1245), and the GUC is only ever set to a user id
--    the handler legitimately holds.
--
-- `app.token_credential` therefore has to appear in BOTH reset lists
-- (`lib/db/pool.ts`, `lib/db/request-connection.ts`) — #2446's failure mode is a
-- privilege GUC surviving a pool checkout into an unrelated request, and this one
-- carries credential material, so it is cleared to the empty string, which every
-- arm compares unequal to any real hash.
--
-- app.auth_lookup's own meaning is unchanged: the users/email lookups from
-- 0088/0099 do not reference app.token_credential and behave exactly as before.
--
-- Written as a DO block (0100/0105/0122/0133/0134's shape), so applying by hand and
-- having db:migrate replay it are the same no-op, and a database that never had
-- 0134 still ends in the right state.

DO $$
BEGIN
  -- ── password_resets ──────────────────────────────────────────────

  DROP POLICY IF EXISTS "password_resets_auth_lookup" ON "password_resets";
  CREATE POLICY "password_resets_auth_lookup" ON "password_resets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND "token" = current_setting('app.token_credential', true)
      AND deleted_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "password_resets_token_claim_read" ON "password_resets";
  CREATE POLICY "password_resets_token_claim_read" ON "password_resets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "token" = current_setting('app.token_credential', true)
    );

  DROP POLICY IF EXISTS "password_resets_token_claim" ON "password_resets";
  CREATE POLICY "password_resets_token_claim" ON "password_resets"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "token" = current_setting('app.token_credential', true)
      AND deleted_at IS NULL
      AND expires_at > now()
    )
    WITH CHECK (deleted_at IS NOT NULL);

  DROP POLICY IF EXISTS "password_resets_token_retire" ON "password_resets";
  CREATE POLICY "password_resets_token_retire" ON "password_resets"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_retire_user', true))::text <> ''
      AND user_id = NULLIF(current_setting('app.token_retire_user', true), '')::uuid
      AND deleted_at IS NULL
    )
    WITH CHECK (
      user_id = NULLIF(current_setting('app.token_retire_user', true), '')::uuid
      AND deleted_at IS NOT NULL
    );

  DROP POLICY IF EXISTS "password_resets_token_retire_read" ON "password_resets";
  CREATE POLICY "password_resets_token_retire_read" ON "password_resets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_retire_user', true))::text <> ''
      AND user_id = NULLIF(current_setting('app.token_retire_user', true), '')::uuid
    );

  -- ── email_verifications ──────────────────────────────────────────

  DROP POLICY IF EXISTS "email_verifications_auth_lookup" ON "email_verifications";
  CREATE POLICY "email_verifications_auth_lookup" ON "email_verifications"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND "token_hash" = current_setting('app.token_credential', true)
      AND used_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "email_verifications_token_claim_read" ON "email_verifications";
  CREATE POLICY "email_verifications_token_claim_read" ON "email_verifications"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "token_hash" = current_setting('app.token_credential', true)
    );

  DROP POLICY IF EXISTS "email_verifications_token_claim" ON "email_verifications";
  CREATE POLICY "email_verifications_token_claim" ON "email_verifications"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "token_hash" = current_setting('app.token_credential', true)
      AND used_at IS NULL
      AND expires_at > now()
    )
    WITH CHECK (used_at IS NOT NULL);

  -- ── oauth_codes ──────────────────────────────────────────────────

  DROP POLICY IF EXISTS "oauth_codes_auth_lookup" ON "oauth_codes";
  CREATE POLICY "oauth_codes_auth_lookup" ON "oauth_codes"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND "code" = current_setting('app.token_credential', true)
      AND used_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_codes_token_claim_read" ON "oauth_codes";
  CREATE POLICY "oauth_codes_token_claim_read" ON "oauth_codes"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "code" = current_setting('app.token_credential', true)
    );

  DROP POLICY IF EXISTS "oauth_codes_token_claim" ON "oauth_codes";
  CREATE POLICY "oauth_codes_token_claim" ON "oauth_codes"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND "code" = current_setting('app.token_credential', true)
      AND used_at IS NULL
      AND expires_at > now()
    )
    WITH CHECK (used_at IS NOT NULL);
END $$;

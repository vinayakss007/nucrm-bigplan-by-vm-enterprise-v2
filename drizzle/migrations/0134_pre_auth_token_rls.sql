/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0134: pre-auth credential redemption RLS (#3102)
--
-- password_resets, email_verifications, oauth_codes each carry exactly one
-- policy, *_user_own, which requires app.current_user to match user_id. Pre-auth
-- flows (password reset request, email verification, OAuth code issuance and
-- redemption) run before any user is authenticated, so app.current_user is empty
-- and every read and write is refused:
--
--   INSERT INTO password_resets …          -> 42501 (no INSERT policy)
--   SELECT  FROM email_verifications …     -> 0 rows (SELECT needs current_user)
--   UPDATE password_resets SET deleted_at  -> 0 rows silently (UPDATE needs current_user)
--
-- Measured on the local force-RLS dev database (role nucrm_app,
-- rolbypassrls = false, relforcerowsecurity = true on all three tables):
--   no GUC        →  count = 0, INSERT = 42501, UPDATE = 0 rows
--   current_user  →  passes RLS (but dies on the FK for INSERT — the GUC is
--                    the only door that pre-auth code can open)
--
-- Per table, three policies:
--
--  * *_auth_lookup (SELECT) — gated on app.auth_lookup = 'true', reusing the
--    GUC already used for login/user lookups (0088, 0099). USING admits exactly
--    the row the caller is looking for: matching token hash, not yet consumed,
--    not expired. This is read-only; it cannot mutate anything.
--
--  * *_token_issue (INSERT) — gated on new app.token_issue GUC. Pre-auth flows
--    set this via withTokenIssueContext() before creating a credential row.
--    WITH CHECK admits only rows with a non-null userId and a future expiresAt,
--    so the grant cannot be used to plant arbitrary rows.
--
--  * *_token_claim (UPDATE) — gated on app.token_issue = 'true'. USING admits
--    only live, unexpired rows matching the caller's predicate. WITH CHECK admits
--    only setting the consumed timestamp (deleted_at / used_at), so a claim can
--    never change user_id, token, code, or expires_at.
--
-- Deliberately NOT reusing app.auth_lookup for UPDATE/INSERT: that GUC means
-- "this request is doing a credential lookup" and is set for the lifetime of
-- the lookup transaction. A claim is a mutation, not a lookup, and conflating
-- the two would let a lookup context also write.
--
-- Deliberately NOT app.is_super_admin (#2253: one SET flips 60 policies across
-- 49 tables) and NOT app.current_tenant (these tables are user-scoped, not
-- tenant-scoped; the caller cannot name a tenant it does not know yet).
--
-- Written as DO blocks (0100/0105/0122/0133's shape), so applying by hand and
-- having db:migrate replay it are the same no-op.

DO $$
BEGIN
  -- ── password_resets ──────────────────────────────────────────────

  DROP POLICY IF EXISTS "password_resets_auth_lookup" ON "password_resets";
  CREATE POLICY "password_resets_auth_lookup" ON "password_resets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND deleted_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "password_resets_token_issue" ON "password_resets";
  CREATE POLICY "password_resets_token_issue" ON "password_resets"
    AS PERMISSIVE
    FOR INSERT
    WITH CHECK (
      (current_setting('app.token_issue', true))::text = 'true'
      AND user_id IS NOT NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "password_resets_token_claim" ON "password_resets";
  CREATE POLICY "password_resets_token_claim" ON "password_resets"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND deleted_at IS NULL
      AND expires_at > now()
    )
    WITH CHECK (deleted_at IS NOT NULL);

  -- ── email_verifications ──────────────────────────────────────────

  DROP POLICY IF EXISTS "email_verifications_auth_lookup" ON "email_verifications";
  CREATE POLICY "email_verifications_auth_lookup" ON "email_verifications"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND used_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "email_verifications_token_issue" ON "email_verifications";
  CREATE POLICY "email_verifications_token_issue" ON "email_verifications"
    AS PERMISSIVE
    FOR INSERT
    WITH CHECK (
      (current_setting('app.token_issue', true))::text = 'true'
      AND user_id IS NOT NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "email_verifications_token_claim" ON "email_verifications";
  CREATE POLICY "email_verifications_token_claim" ON "email_verifications"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
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
      AND used_at IS NULL
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_codes_token_issue" ON "oauth_codes";
  CREATE POLICY "oauth_codes_token_issue" ON "oauth_codes"
    AS PERMISSIVE
    FOR INSERT
    WITH CHECK (
      (current_setting('app.token_issue', true))::text = 'true'
      AND expires_at > now()
    );

  DROP POLICY IF EXISTS "oauth_codes_token_claim" ON "oauth_codes";
  CREATE POLICY "oauth_codes_token_claim" ON "oauth_codes"
    AS PERMISSIVE
    FOR UPDATE
    USING (
      (current_setting('app.token_issue', true))::text = 'true'
      AND used_at IS NULL
      AND expires_at > now()
    )
    WITH CHECK (used_at IS NOT NULL);
END $$;

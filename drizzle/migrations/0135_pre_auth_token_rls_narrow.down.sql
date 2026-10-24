/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0135 down: restore 0134's pre-auth redemption policies (#3218)
--
-- Re-creates the six 0134 arms verbatim and drops the three claim-read arms and
-- the two retire arms. Rolling back therefore returns the database to the state
-- #3210 shipped — including the enumeration surface 0135 was written to close, so
-- this is a rollback of a security narrowing and should not be taken lightly.

DO $$
BEGIN
  DROP POLICY IF EXISTS "password_resets_token_claim_read" ON "password_resets";
  DROP POLICY IF EXISTS "password_resets_token_retire" ON "password_resets";
  DROP POLICY IF EXISTS "password_resets_token_retire_read" ON "password_resets";
  DROP POLICY IF EXISTS "email_verifications_token_claim_read" ON "email_verifications";
  DROP POLICY IF EXISTS "oauth_codes_token_claim_read" ON "oauth_codes";

  DROP POLICY IF EXISTS "password_resets_auth_lookup" ON "password_resets";
  CREATE POLICY "password_resets_auth_lookup" ON "password_resets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND deleted_at IS NULL
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

  DROP POLICY IF EXISTS "email_verifications_auth_lookup" ON "email_verifications";
  CREATE POLICY "email_verifications_auth_lookup" ON "email_verifications"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND used_at IS NULL
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

  DROP POLICY IF EXISTS "oauth_codes_auth_lookup" ON "oauth_codes";
  CREATE POLICY "oauth_codes_auth_lookup" ON "oauth_codes"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (current_setting('app.auth_lookup', true))::text = 'true'
      AND used_at IS NULL
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

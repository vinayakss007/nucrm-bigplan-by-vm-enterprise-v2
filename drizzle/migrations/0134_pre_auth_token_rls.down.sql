/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0134 down: remove pre-auth credential redemption RLS policies (#3102)

DO $$
BEGIN
  DROP POLICY IF EXISTS "password_resets_auth_lookup" ON "password_resets";
  DROP POLICY IF EXISTS "password_resets_token_issue" ON "password_resets";
  DROP POLICY IF EXISTS "password_resets_token_claim" ON "password_resets";

  DROP POLICY IF EXISTS "email_verifications_auth_lookup" ON "email_verifications";
  DROP POLICY IF EXISTS "email_verifications_token_issue" ON "email_verifications";
  DROP POLICY IF EXISTS "email_verifications_token_claim" ON "email_verifications";

  DROP POLICY IF EXISTS "oauth_codes_auth_lookup" ON "oauth_codes";
  DROP POLICY IF EXISTS "oauth_codes_token_issue" ON "oauth_codes";
  DROP POLICY IF EXISTS "oauth_codes_token_claim" ON "oauth_codes";
END $$;

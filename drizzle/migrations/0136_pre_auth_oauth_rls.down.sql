/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0136 down: drop the four arms, restore the pre-#3225 state (#3225)
--
-- 0136 only ADDS policies — it does not re-create or narrow anything that already
-- existed, so the rollback is four drops and there is nothing to re-install. Rolling
-- back returns `POST /api/auth/oauth/token` to answering `401 invalid_client` for a
-- correct secret and its refresh rotation to a silent zero-row write, which is the
-- broken state the issue was filed against.

DO $$
BEGIN
  DROP POLICY IF EXISTS "oauth_tokens_refresh_claim" ON "oauth_tokens";
  DROP POLICY IF EXISTS "oauth_tokens_refresh_claim_read" ON "oauth_tokens";
  DROP POLICY IF EXISTS "oauth_tokens_token_issue" ON "oauth_tokens";
  DROP POLICY IF EXISTS "oauth_clients_client_lookup" ON "oauth_clients";
END $$;

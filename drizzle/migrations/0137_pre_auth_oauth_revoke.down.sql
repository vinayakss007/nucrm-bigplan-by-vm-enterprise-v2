/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0137 down: drop the two access-claim arms, restore the pre-#3231 state (#3231)
--
-- 0137 only ADDS policies, so the rollback is two drops. Rolling back returns
-- `POST /api/auth/oauth/revoke` to a state where no context can retire an access token:
-- both the `token_type_hint=access_token` branch and the no-hint branch go back to
-- claiming zero rows and answering `{"ok":true,"revoked":false}` over a live token.

DO $$
BEGIN
  DROP POLICY IF EXISTS "oauth_tokens_access_claim" ON "oauth_tokens";
  DROP POLICY IF EXISTS "oauth_tokens_access_claim_read" ON "oauth_tokens";
END $$;

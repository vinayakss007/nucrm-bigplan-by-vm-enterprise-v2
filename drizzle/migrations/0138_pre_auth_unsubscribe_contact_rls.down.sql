/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0138 down: drop the two claim arms, restore the pre-#3237 state (#3237)
--
-- 0138 only ADDS policies — it does not re-create or narrow anything that already
-- existed, so the rollback is two drops and there is nothing to re-install. Rolling
-- back returns `GET|POST /api/unsubscribe` to answering 404 "Contact not found" for
-- a valid, HMAC-verified link and leaving the contact subscribed, which is the state
-- the issue was filed against.

DO $$
BEGIN
  DROP POLICY IF EXISTS "contacts_unsubscribe_claim" ON "contacts";
  DROP POLICY IF EXISTS "contacts_unsubscribe_claim_read" ON "contacts";
END $$;

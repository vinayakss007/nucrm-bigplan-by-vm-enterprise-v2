/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0141 rollback (#3246 step 4c): drop the read arm and create nothing.
--
-- Rolling this back returns `POST /api/webhooks/payu` to answering `quote_not_found` for
-- every verified payment — the state the step was filed against, not a neutral rollback.
-- Take it back together with the route, or the callback goes dark while the code still
-- looks correct.
--
-- `app.quote_webhook_id` stays on both pooled reset lists: a GUC with no policy behind it
-- is inert, and removing a claim from the reset is the part #2446 says never to do.

DO $$
BEGIN
  DROP POLICY IF EXISTS "quotes_webhook_lookup_read" ON "quotes";
END $$;

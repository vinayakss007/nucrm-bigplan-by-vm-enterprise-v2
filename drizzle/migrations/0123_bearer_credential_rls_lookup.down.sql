/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0123 down: drop the bearer-credential read paths (#2468).
--
-- This restores the fail-closed state exactly: with these three policies gone,
-- `quotes`, `csat_surveys` and `signing_requests` are visible only through
-- `tenant_isolation`, which an unauthenticated public request cannot satisfy —
-- so the offer page 404s, the CSAT link 404s and the signing link 404s again.
-- That is the behaviour #2468 filed, not a neutral rollback: roll this back only
-- together with the routes that now open a credential context for these reads,
-- or the whole surface goes dark while the code still looks correct.
--
-- No data depends on a policy, so nothing here touches a row. 0122's own arms
-- (portal_clients, platform_settings, support_tickets) are not touched: they
-- belong to that migration, and `app.portal_lookup_token` keeps its meaning.
DROP POLICY IF EXISTS "quotes_offer_credential_lookup" ON "quotes";
--> statement-breakpoint
DROP POLICY IF EXISTS "csat_surveys_credential_lookup" ON "csat_surveys";
--> statement-breakpoint
DROP POLICY IF EXISTS "signing_requests_signer_credential_lookup" ON "signing_requests";

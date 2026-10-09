/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0122 down: drop the portal credential read paths (#2446).
--
-- This restores the fail-closed state exactly: with these three policies gone,
-- `portal_clients`, `platform_settings` and `support_tickets` are visible only
-- through `tenant_isolation`, which an unauthenticated portal request cannot
-- satisfy — so portal login 403s and every portal list 401s again. That is the
-- behaviour #2446 filed, not a neutral rollback: roll this back only together
-- with the routes that now depend on the contexts, or the portal goes dark
-- while the code still looks correct.
--
-- No data depends on a policy, so nothing here touches a row.
DROP POLICY IF EXISTS "portal_clients_credential_lookup" ON "portal_clients";
--> statement-breakpoint
DROP POLICY IF EXISTS "platform_settings_portal_config_lookup" ON "platform_settings";
--> statement-breakpoint
DROP POLICY IF EXISTS "support_tickets_portal_token_lookup" ON "support_tickets";

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- Rollback of 0133_invitations_credential_lookup.sql (#3182).
--
-- Dropping this arm returns `invitations` to a single `tenant_isolation` policy,
-- which is what made the acceptance flow unreadable in the first place: the routes
-- that now open `withPortalLookupContext()` for this read would go back to
-- answering 404 "Invitation not found or expired" for every genuine invitation.
-- That is the defect #3182 filed, not a neutral rollback — roll this back only
-- together with those routes, or the invite flow goes dark while the code still
-- looks correct.
--
-- No data depends on a policy, so nothing here touches a row. 0122's and 0123's
-- arms are not touched: `app.portal_lookup_token` keeps its meaning and every
-- other credential read keeps its own arm.
DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations";

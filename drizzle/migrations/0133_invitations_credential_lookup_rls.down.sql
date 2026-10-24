/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0133 down: drop the credential read and nothing else (#3182).
--
-- `tenant_isolation` was never modified, so dropping this policy returns
-- `invitations` to the state 0037 left it in — readable only under a tenant
-- context. That is the pre-0133 behaviour, which is to say invite acceptance 404s
-- again; no rows are touched in either direction.
DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations";

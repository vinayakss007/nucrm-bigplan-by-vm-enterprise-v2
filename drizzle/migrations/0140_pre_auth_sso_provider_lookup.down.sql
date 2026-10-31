/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0140 rollback (#3246 step 3): drop both lookup arms and create nothing.
--
-- Rolling back returns `/api/auth/sso` to answering 404 "No SSO provider is
-- configured for <domain>" and "SSO provider is no longer available" for every
-- correctly signed login, which is the state this step was filed against.
-- `app.sso_lookup_domain` and `app.sso_provider_id` stay on both reset lists — a
-- GUC with no policy behind it is inert, and removing it from the reset is the part
-- #2446 says never to do.

DO $$
BEGIN
  DROP POLICY IF EXISTS "sso_providers_domain_lookup_read" ON "sso_providers";
  DROP POLICY IF EXISTS "sso_providers_id_lookup_read" ON "sso_providers";
END $$;

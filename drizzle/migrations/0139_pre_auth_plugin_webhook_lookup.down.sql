/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0139 rollback (#3246): drop the lookup arm and create nothing.
--
-- Rolling back returns `POST /api/tenant/plugins/webhook/[id]` to answering 404
-- "Plugin" for every correctly signed callback, which is the state the issue was
-- filed against. `app.plugin_webhook_id` stays on both reset lists — a GUC with no
-- policy behind it is inert, and removing it from the reset is the part #2446 says
-- never to do.

DO $$
BEGIN
  DROP POLICY IF EXISTS "custom_plugins_webhook_lookup_read" ON "custom_plugins";
END $$;

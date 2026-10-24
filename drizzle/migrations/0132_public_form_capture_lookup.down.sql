/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0132 down: drop the anonymous form-capture read only (#3163).
--
-- `tenant_isolation` was never modified, so there is nothing to restore: dropping this
-- policy returns `forms` to the state 0031/0088 left it in — a tenant reads its own
-- forms, an unauthenticated request reads none. No rows are touched in either direction.
DROP POLICY IF EXISTS "forms_public_capture_lookup" ON "forms";

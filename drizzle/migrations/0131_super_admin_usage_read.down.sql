/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0131 down: drop the SELECT waiver only (#2880).
--
-- `tenant_isolation` was never modified, so there is nothing to restore: dropping this
-- policy returns the table to exactly the state `0037` left it in — tenants read their
-- own rows, the platform console reads none. No rows are touched in either direction.
DROP POLICY IF EXISTS "ai_usage_aggregated_super_admin_read" ON "ai_usage_aggregated";

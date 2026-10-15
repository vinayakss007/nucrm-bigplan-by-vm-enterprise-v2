/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0129 down: drop the partial unique index (#2633).
--
-- The dedupe DELETEs are intentionally NOT resurrected: the removed rows were
-- duplicate template-applied automations, not user-authored data, and their
-- re-insertion would restore exactly the double-firing behaviour #2633 filed.
DROP INDEX IF EXISTS "automations_tenant_name_live_unique";

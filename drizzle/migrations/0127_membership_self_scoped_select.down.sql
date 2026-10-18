/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0127 down: drop the membership self-reads (#2626).
--
-- This restores the fail-closed state exactly: with these two policies gone,
-- tenant_members and roles are visible only through `tenant_isolation`, which
-- a session redemption cannot satisfy because app.current_tenant is what the
-- read exists to discover — so every non-super-admin login starts 403ing
-- "No active workspace" again. That is the behaviour #2626 filed, not a
-- neutral rollback: roll this back only together with the auth path that now
-- depends on the self-read, or the entire tenant surface goes dark while the
-- code still looks correct.
--
-- No data depends on a policy, so nothing here touches a row.
DROP POLICY IF EXISTS "tenant_members_self_read" ON "tenant_members";
--> statement-breakpoint
DROP POLICY IF EXISTS "roles_tenant_member_read" ON "roles";

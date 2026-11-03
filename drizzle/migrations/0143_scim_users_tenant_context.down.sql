/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- Rollback for 0143. Both arms are additive and keyed on a GUC whose reset lists
-- clear it on every checkout, so removing them restores the 0088/0089 set exactly.
DO $$
BEGIN
  DROP POLICY IF EXISTS "users_tenant_scim_read" ON "users";
  DROP POLICY IF EXISTS "users_tenant_scim_update" ON "users";
END $$;

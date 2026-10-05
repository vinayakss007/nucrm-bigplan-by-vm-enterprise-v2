/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2343 down: restore the plain (non-unique) index. Deduped rows keep their
-- re-assigned labels — reverting the data is neither safe nor meaningful, so
-- this down only reverts the index shape.
DROP INDEX IF EXISTS "idx_leads_tenant_oid";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_tenant_oid" ON "leads" ("tenant_id", "lead_oid");

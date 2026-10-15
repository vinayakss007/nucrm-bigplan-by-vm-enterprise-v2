/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0128 down: remove the seeded built-in templates (#2633).
--
-- Deletes the ledger (tenant_templates) before the rows it references:
-- tenant_templates.templateId cascades on delete in the schema, but doing it
-- explicitly keeps the rollback reviewable and does not depend on the
-- migrate role's RLS visibility into tenant-scoped tables.
-- Behind the same app.is_super_admin GUC as the up: product_templates' write
-- policies reject the delete without it on any non-superuser migrate role,
-- which would leave a half-rolled-back state (ledger gone, templates live).
-- The added column is dropped last; its JSONB content belongs to the deleted
-- rows only.

DO $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'true', true);

  DELETE FROM "tenant_templates"
    WHERE "template_id" IN (SELECT "id" FROM "product_templates" WHERE "is_builtin" = true);

  DELETE FROM "product_templates" WHERE "is_builtin" = true;
END $$;
--> statement-breakpoint
ALTER TABLE "product_templates" DROP COLUMN IF EXISTS "default_dashboard_layout";

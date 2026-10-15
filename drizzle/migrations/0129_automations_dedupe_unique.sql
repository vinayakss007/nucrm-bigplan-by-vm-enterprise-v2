/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0129: make automations' onConflictDoNothing real (#2633).
--
-- The template apply path has always ended its automation insert with
-- .onConflictDoNothing(), but automations carried no unique constraint for
-- the conflict to ever hit — so the guard is vacuous and every re-apply of a
-- template added a second ACTIVE copy of each automation. Measured on the dev
-- host: applying "legal" twice produced two live "New case task" rows, i.e.
-- every future deal.created fires the follow-up action twice. The same class
-- of damage on pipelines/stages is fixed in code (applyTemplate reuses by
-- name); automations can additionally carry a real constraint because, unlike
-- stage names, no legitimate tenant has two same-named live automations.
--
-- Dedupe first (keep the oldest live row per (tenant_id, name) — the one the
-- later duplicates shadow), restricted to deleted_at IS NULL so soft-deleted
-- history never constrains a re-created automation. The partial unique index
-- then matches applyTemplate's own check-then-insert predicate exactly, so
-- the index is belt-and-braces, not the mechanism tenants depend on.
--
-- RLS
-- ---
-- automations is FORCE ROW LEVEL SECURITY with a tenant_isolation policy that
-- reads app.current_tenant, and scripts/migrate.ts runs on a bare pool as a
-- role that is owner-but-not-superuser — the PP-058 case 0125's header spells
-- out: a bare DELETE would report DELETE 0 and the CREATE UNIQUE INDEX would
-- then abort on the duplicates it could not see. So the dedupe loops the GUC
-- per tenant exactly like 0125; app.is_super_admin is set once per block as
-- the marker guard:migration-rls recognises, not as the visibility mechanism
-- (tenant_isolation does not branch on it).

DO $$
DECLARE
  t RECORD;
BEGIN
  PERFORM set_config('app.is_super_admin', 'true', true);
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM set_config('app.current_tenant', t.id::text, true);
    DELETE FROM "automations" a
      USING "automations" b
      WHERE a."tenant_id" = t.id
        AND b."tenant_id" = t.id
        AND a."name" = b."name"
        AND a."deleted_at" IS NULL
        AND b."deleted_at" IS NULL
        AND a."ctid" > b."ctid";
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automations_tenant_name_live_unique"
  ON "automations" ("tenant_id", "name")
  WHERE "deleted_at" IS NULL;

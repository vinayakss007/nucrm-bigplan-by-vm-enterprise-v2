-- 0125: enforce the six NOT NULL columns that drizzle/schema declares and the migration chain never builds (#2509).
--
-- WHAT
-- ----
-- Six columns come out of `npm run db:bootstrap` nullable while the code that
-- reads and writes them declares them NOT NULL:
--
--   custom_entities.fields            drizzle/schema/custom-entities.ts:17
--   custom_entities.settings          drizzle/schema/custom-entities.ts:18
--   custom_entities.created_at        drizzle/schema/utils.ts:51 via lifecycle() (:68)
--   custom_entity_data.data           drizzle/schema/custom-entities.ts:35
--   custom_entity_data.created_at     same utils.lifecycle() spread, custom-entities.ts:36
--   segment_members.id                drizzle/schema/segments.ts:38 via utils.pk() (:45)
--
-- Each `SET NOT NULL` is preceded by a catalogue-guarded backfill that fills
-- every NULL with the value that column's own DEFAULT already supplies, so the
-- constraint can be added on a database that has already taken a NULL — the
-- five pre-prod columns are correct only because that build's history includes
-- a `drizzle-kit push`, and a restore-and-replay (`scripts/restore-db.ts`,
-- docs/migration-recovery.md) or any new environment gets the chain's answer,
-- which is this one.
--
-- WHY THE CHAIN BUILDS THEM NULLABLE
-- ----------------------------------
-- `0059_custom_entities.sql` creates both custom-entity tables loosely:
--
--   fields   JSONB DEFAULT '[]'::jsonb,        -- :12   no NOT NULL
--   settings JSONB DEFAULT '{}'::jsonb,        -- :13   no NOT NULL
--   created_at TIMESTAMPTZ DEFAULT now(),      -- :15   no NOT NULL
--   data     JSONB DEFAULT '{}'::jsonb,        -- :31   no NOT NULL
--
-- `0071_schema_drift_backfill.sql` noticed and re-created the tables with the
-- NOT NULLs (:60, with :67, :68, :70 and :78, :81). It is a
-- `CREATE TABLE IF NOT EXISTS`. On every database that applies the chain in
-- order, 0059 has already created those names, so the statement is parsed,
-- discarded, and its column list **never executes**. The same shape covers
-- `segment_members.id`: 0071:57 adds it as
-- `ALTER TABLE segment_members ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid()`
-- — `ADD COLUMN IF NOT EXISTS` *does* run, but without NOT NULL, and nothing
-- since has tightened it. `0110` and `0113`–`0124` touch indexes, FKs, CHECKs
-- and policies; `grep -l 'SET NOT NULL' drizzle/migrations/*.sql` before this
-- file found exactly one hit, `0109_webhook_events_created_at_not_null.sql`.
--
-- The lesson for the next backfill migration is in the first paragraph of
-- 0071's own header: it is a *column-level audit* result expressed as DDL. A
-- re-CREATE is not a repair. Use `ALTER TABLE … ALTER COLUMN … SET NOT NULL`.
--
-- RLS
-- ---
-- All three tables are FORCE ROW LEVEL SECURITY (measured on a chain build:
-- `relrowsecurity = t`, `relforcerowsecurity = t` for each) with a
-- `tenant_isolation` policy, and `scripts/migrate.ts` connects as a role that
-- is the tables' OWNER but neither superuser nor BYPASSRLS — the case FORCE
-- exists to catch. So the backfill has to reach its rows through the GUC those
-- policies actually read, which is not the one `0109` uses:
--
--   custom_entities / custom_entity_data
--     USING (current_setting('app.current_tenant', true) <> ''
--            AND tenant_id = NULLIF(current_setting('app.current_tenant', true),'')::uuid)
--   segment_members
--     USING (tenant_id IS NULL OR tenant_id = …'app.current_tenant'…)
--
-- Neither branches on `app.is_super_admin`. Measured on a chain-built database
-- holding one NULL row, as the owner with `SET ROLE`: the `UPDATE` under
-- `set_config('app.is_super_admin','true',true)` reports `UPDATE 0` and the
-- following `SET NOT NULL` aborts — 23502, "column "fields" … contains null
-- values" — which is PP-058's failure mode reproduced, not avoided. Setting
-- `app.current_tenant` per tenant makes the row visible (`UPDATE 1`) and the
-- constraint lands. `app.is_super_admin` is still set once per block because
-- `guard:migration-rls` recognises that statement as the marker for a write that
-- is not RLS-blind; on these three policies it is inert, and that is written
-- here rather than left for the next reader to rediscover.
--
-- Iterating `public.tenants` covers every row: `tenants_read_all USING (true)`
-- makes the list visible to this role, and `tenant_id` is NOT NULL with a
-- FK to `tenants(id)` on all three tables (0059:7, :29; segments' own
-- `utils.tenantId()`), so no row can belong to a tenant that is not in it.
-- The list cannot be derived from the three tables themselves — measured in the
-- same session, `SELECT count(*) FROM custom_entities` with no tenant GUC set is
-- **0**, the row is invisible to its own owner. That is also why this migration
-- assumes what every other migration in the chain assumes: the runner may read
-- `public.tenants`. A role that owns the three targets but not `tenants` fails
-- the first block loudly with `42501 permission denied for table tenants`
-- (measured when `tenants` was left owned by another role), not silently.
--
-- IDEMPOTENCY: safe to re-run. Each block opens with an `is_nullable = 'YES'`
-- catalogue check and returns immediately where the constraint already holds
-- (that is pre-prod for five of the six), every per-tenant `UPDATE` matches zero
-- rows once the column is clean, and `SET NOT NULL` itself is a no-op where it is
-- already enforced.

DO $$
DECLARE
  t RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'custom_entities'
       AND is_nullable  = 'YES'
       AND column_name  IN ('fields', 'settings', 'created_at')
  ) THEN
    PERFORM set_config('app.is_super_admin', 'true', true);
    FOR t IN SELECT id FROM public.tenants LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      UPDATE "custom_entities"
         SET "fields"     = COALESCE("fields",     '[]'::jsonb),
             "settings"   = COALESCE("settings",   '{}'::jsonb),
             "created_at" = COALESCE("created_at", now())
       WHERE "tenant_id" = t.id
         AND ("fields" IS NULL OR "settings" IS NULL OR "created_at" IS NULL);
    END LOOP;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "custom_entities" ALTER COLUMN "fields" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entities" ALTER COLUMN "settings" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entities" ALTER COLUMN "created_at" SET NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  t RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'custom_entity_data'
       AND is_nullable  = 'YES'
       AND column_name  IN ('data', 'created_at')
  ) THEN
    PERFORM set_config('app.is_super_admin', 'true', true);
    FOR t IN SELECT id FROM public.tenants LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      UPDATE "custom_entity_data"
         SET "data"       = COALESCE("data", '{}'::jsonb),
             "created_at" = COALESCE("created_at", now())
       WHERE "tenant_id" = t.id
         AND ("data" IS NULL OR "created_at" IS NULL);
    END LOOP;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "custom_entity_data" ALTER COLUMN "data" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_entity_data" ALTER COLUMN "created_at" SET NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  t RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'segment_members'
       AND column_name  = 'id'
       AND is_nullable  = 'YES'
  ) THEN
    PERFORM set_config('app.is_super_admin', 'true', true);
    -- Its own policy also lets a NULL-tenant row through, but the column is
    -- NOT NULL with a FK to tenants, so the loop is exhaustive either way.
    FOR t IN SELECT id FROM public.tenants LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      UPDATE "segment_members"
         SET "id" = gen_random_uuid()
       WHERE "id" IS NULL
         AND ("tenant_id" = t.id OR "tenant_id" IS NULL);
    END LOOP;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "segment_members" ALTER COLUMN "id" SET NOT NULL;

-- NOT IN THIS MIGRATION, and deliberately so:
--   segment_members has no PRIMARY KEY in any build this repo can produce,
--   while utils.pk() (drizzle/schema/utils.ts:45) declares `id` as
--   .primaryKey() — `pg_constraint` for that table returns two FKs and contype
--   'p' returns nothing, on the chain build and on preprod alike. The index
--   named idx_segment_members_pk is a plain non-unique btree on
--   (segment_id, entity_id). Making `id` a real primary key needs a uniqueness
--   decision that SET NOT NULL does not, so it is not smuggled in here.

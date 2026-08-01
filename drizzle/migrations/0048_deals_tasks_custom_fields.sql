-- Migration: 0048_deals_tasks_custom_fields
--
-- `contacts`, `companies` and `leads` have carried a first-class `custom_fields`
-- jsonb column since 0000_init, but `deals` and `tasks` never did. The inbound
-- webhook handler nonetheless built a `customFields` value for deals and handed
-- it to Drizzle, which silently drops keys that have no matching column — so a
-- caller sending custom fields on a deal got a 200 and lost the data.
--
-- This adds the missing column to both tables so the value has somewhere to go.
--
-- Idempotent: every statement is guarded, so this is safe on a fresh database
-- and on one that already has the column.

-- ── deals.custom_fields ───────────────────────────────────────────────────────

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'deals') THEN
      ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb;

      -- Backfill so readers never have to handle NULL. Rows that predate the
      -- column get NULL rather than the DEFAULT, so this is not redundant.
      UPDATE "deals" SET "custom_fields" = '{}'::jsonb WHERE "custom_fields" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_deals_custom_fields_g" ON "deals" USING gin ("custom_fields");
    END IF;
  END;
$$;

-- ── tasks.custom_fields ───────────────────────────────────────────────────────

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks') THEN
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb;

      UPDATE "tasks" SET "custom_fields" = '{}'::jsonb WHERE "custom_fields" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_tasks_custom_fields_g" ON "tasks" USING gin ("custom_fields");
    END IF;
  END;
$$;

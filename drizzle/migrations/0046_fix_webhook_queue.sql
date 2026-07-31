-- ============================================================================
-- 0046: Repair webhook_queue
--
-- Migration 0002 created webhook_queue WITHOUT a tenant_id column and with a
-- foreign key pointing at webhooks(id). Migration 0004 tried to re-create the
-- table with tenant_id using CREATE TABLE IF NOT EXISTS, which is a silent
-- no-op because the table already existed. The application inserts rows whose
-- webhook_id is an integrations(id) (integrations WHERE type = 'webhook'), so
-- every insert violated webhook_queue_webhook_id_webhooks_id_fk and outbound
-- webhook delivery never happened.
--
-- This migration is idempotent and safe on both a fresh and an existing DB.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Add the missing tenant_id column
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      ALTER TABLE "webhook_queue" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 2: Backfill tenant_id from the owning integrations row
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'integrations') THEN
      UPDATE "webhook_queue" wq
        SET "tenant_id" = i."tenant_id"
        FROM "integrations" i
        WHERE wq."webhook_id" = i."id"
          AND wq."tenant_id" IS NULL;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 3: Delete orphan rows that still have no tenant_id (undeliverable)
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      DELETE FROM "webhook_queue" WHERE "tenant_id" IS NULL;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 4: Enforce NOT NULL, but only when no NULL rows remain
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      IF NOT EXISTS (SELECT 1 FROM "webhook_queue" WHERE "tenant_id" IS NULL) THEN
        ALTER TABLE "webhook_queue" ALTER COLUMN "tenant_id" SET NOT NULL;
      END IF;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 5: FK tenant_id -> tenants(id) ON DELETE CASCADE
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 6: Drop the incorrect FK webhook_id -> webhooks(id)
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_webhook_id_webhooks_id_fk') THEN
      ALTER TABLE "webhook_queue" DROP CONSTRAINT "webhook_queue_webhook_id_webhooks_id_fk";
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 7: Remove rows whose webhook_id has no matching integrations row, so
--         the replacement constraint can actually be created
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'integrations') THEN
      DELETE FROM "webhook_queue" wq
        WHERE NOT EXISTS (
          SELECT 1 FROM "integrations" i WHERE i."id" = wq."webhook_id"
        );
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 8: FK webhook_id -> integrations(id) ON DELETE CASCADE
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'integrations') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_webhook_id_integrations_id_fk') THEN
      ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_webhook_id_integrations_id_fk"
        FOREIGN KEY ("webhook_id") REFERENCES "integrations"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 9: Index on tenant_id
-- ----------------------------------------------------------------------------
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      CREATE INDEX IF NOT EXISTS "idx_webhook_queue_tenant" ON "webhook_queue" ("tenant_id");
    END IF;
  END;
$$;

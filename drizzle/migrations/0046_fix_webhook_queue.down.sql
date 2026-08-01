-- Rollback for 0046_fix_webhook_queue
BEGIN;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_webhook_id_integrations_id_fk') THEN
      ALTER TABLE "webhook_queue" DROP CONSTRAINT "webhook_queue_webhook_id_integrations_id_fk";
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "webhook_queue" DROP CONSTRAINT "webhook_queue_tenant_id_tenants_id_fk";
    END IF;
  END;
$$;

DROP INDEX IF EXISTS "idx_webhook_queue_tenant";

ALTER TABLE "webhook_queue" DROP COLUMN IF EXISTS "tenant_id";

COMMIT;

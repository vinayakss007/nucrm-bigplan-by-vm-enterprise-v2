-- Undo 0114 (#2260): put the nine cross-module foreign keys back to NOT VALID.
--
-- Reverting a validation means dropping the constraint and re-adding it with the
-- `NOT VALID` option, using exactly the definition 0038_cross_module_record_linking.sql
-- gave it (same parent, same ON DELETE action) — otherwise the rollback would
-- silently redefine the relationship rather than merely unverify it.
--
-- HEAVIER THAN THE UP PATH — READ THIS BEFORE ROLLING BACK ON A LIVE DATABASE.
-- The up path (VALIDATE CONSTRAINT) is SHARE UPDATE EXCLUSIVE and never rewrites
-- the table. This one is not: DROP CONSTRAINT takes ACCESS EXCLUSIVE and the
-- re-ADD (FOREIGN KEY ... NOT VALID) takes SHARE ROW EXCLUSIVE, so the table is
-- inaccessible to everything but SELECT-for-a-moment at the drop. It is still not a
-- table rewrite and `NOT VALID` skips the scan of existing rows.
--
-- A rollback cannot orphan anything on its own, and re-adding as NOT VALID does not
-- check history, so this file succeeds whether or not orphans exist — which is the
-- point: it restores the pre-#2260 catalogue state faithfully rather than refusing
-- to run. Rows written while the constraint was validated stay valid (NOT VALID
-- still rejects new orphans on INSERT/UPDATE), so nothing needs repairing after.
--
-- Guarded on existence for the same reason the up file is: deployments are
-- half-applied because live deploys do not run migrations (#2233/#2144). A
-- constraint that is absent, or that this deployment never created because the
-- column is missing, is skipped instead of invented.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_deal_id_fkey' AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE "invoices" DROP CONSTRAINT "invoices_deal_id_fkey";
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_fkey"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_company_id_fkey' AND conrelid = 'quotes'::regclass
  ) THEN
    ALTER TABLE "quotes" DROP CONSTRAINT "quotes_company_id_fkey";
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_lead_id_fkey' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" DROP CONSTRAINT "activities_lead_id_fkey";
    ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_company_id_fkey' AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE "tasks" DROP CONSTRAINT "tasks_company_id_fkey";
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_lead_id_fkey' AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE "tasks" DROP CONSTRAINT "tasks_lead_id_fkey";
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_ticket_id_fkey' AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE "tasks" DROP CONSTRAINT "tasks_ticket_id_fkey";
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_company_id_fkey' AND conrelid = 'support_tickets'::regclass
  ) THEN
    ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_company_id_fkey";
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_deal_id_fkey' AND conrelid = 'support_tickets'::regclass
  ) THEN
    ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_deal_id_fkey";
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_deal_id_fkey"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_lead_id_fkey' AND conrelid = 'support_tickets'::regclass
  ) THEN
    ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_lead_id_fkey";
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

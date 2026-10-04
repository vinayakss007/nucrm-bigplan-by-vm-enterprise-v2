-- 0114: validate the nine foreign keys that were left NOT VALID (#2260).
--
-- ROOT CAUSE. 0038_cross_module_record_linking.sql added exactly these nine
-- constraints, deliberately with `NOT VALID` (its own words: the option "enforces
-- the rule on every INSERT and UPDATE from now on, without scanning (and
-- potentially failing on) rows that pre-date the constraint"). The follow-up half
-- of that plan never happened. 0049_fk_integrity.sql is the file that ran the
-- `VALIDATE CONSTRAINT` pass, and it enumerated the 0037/0040/0041 batch —
-- contacts_team_id, leads_requested_product/service/team, the invoice/order/quote
-- line-item chain, 17 constraints in total — and stopped. The nine that 0038
-- created were simply not in that list, so they have been unvalidated since the
-- day they were added. Nothing else created them: `NOT VALID` appears in no other
-- migration, and no runner (scripts/migrate.ts, scripts/migrate-fresh.ts,
-- drizzle.config.ts) emits it, so this is a hand-written migration that skipped
-- its own second step, not drizzle-kit behaviour.
--
-- WHY IT SURVIVED. 0037 told the operator to run `npm run db:validate-constraints`
-- for the deferred half of the plan. That script has never existed in package.json,
-- so the "validate later" instruction had no carrier at all and 0049's hand-typed
-- list was the only implementation of it. The enforcement now lives in CI instead
-- of a comment: tests/unit/schema/fk-not-valid-validated-2260.test.ts parses every
-- migration in journal order and fails if any FK is created `NOT VALID` without a
-- later `VALIDATE CONSTRAINT` for the same (table, constraint).
--
-- WHY IT MATTERS. A NOT VALID FK is not inert: it does block new orphan rows on
-- INSERT/UPDATE, so this is not a live data leak. What it costs is (a) the
-- planner may not treat the relationship as proven — FK-based optimizations such
-- as `constraint_exclusion`/outer-join elimination on these columns are off the
-- table, (b) `pg_constraint.convalidated = false` means no agent or migration
-- reading the catalogue can trust referential integrity on these nine columns,
-- and (c) the deferred scan never went away — it just grew. Validating a table
-- that has been accumulating unverified rows for months is an emergency; doing it
-- now, on invoices=4, quotes=7, activities=43, tasks=23, support_tickets=16 rows,
-- is routine.
--
-- LOCKING. `ALTER TABLE ... VALIDATE CONSTRAINT` takes a SHARE UPDATE EXCLUSIVE
-- lock — weaker than the SHARE ROW EXCLUSIVE the original `ADD FOREIGN KEY`
-- needed, and far weaker than the ACCESS EXCLUSIVE of the plain `ADD CONSTRAINT`
-- form. Concurrent INSERTs/UPDATEs/SELECTs continue; only other DDL waits. There
-- is no table rewrite and no index rebuild, so unlike the lock-heavy ALTER/CREATE
-- INDEX work elsewhere in this file family this is safe to run on a live database.
--
-- IDEMPOTENT BY CONSTRUCTION. Live deploys do not run migrations (#2233/#2144), so
-- a half-applied catalogue state is the normal case: some environments will have
-- run this file, some will not, and one may have died between statement 3 and 4.
-- Every statement is therefore guarded on `NOT convalidated`, which makes an
-- already-valid constraint a no-op NOTICE and a constraint that does not exist in
-- this deployment (the parent table or column was never created, as 0037 had to
-- handle) equally a no-op. Re-running is always harmless.
--
-- DATA REPAIR IS NOT NEEDED HERE, BUT IS PRE-CONDITION ELSEWHERE. VALIDATE fails
-- with 23503 if any pre-existing row is an orphan. The read-only sweep of these
-- nine on the production data found 0 orphans, so all nine validate cleanly and
-- this file makes no attempt to delete or null out rows. If a future environment
-- reports 23503 on one of these, repair the offending child rows first (set the
-- column to NULL, or restore the parent) and leave the rest of this file alone:
-- the guards mean an environment can be part-validated and still converge.

-- invoices.deal_id -> deals(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_deal_id_fkey'
      AND conrelid = 'invoices'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_deal_id_fkey";
    RAISE NOTICE '#2260: validated invoices_deal_id_fkey';
  ELSE
    RAISE NOTICE '#2260: invoices_deal_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- quotes.company_id -> companies(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_company_id_fkey'
      AND conrelid = 'quotes'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "quotes" VALIDATE CONSTRAINT "quotes_company_id_fkey";
    RAISE NOTICE '#2260: validated quotes_company_id_fkey';
  ELSE
    RAISE NOTICE '#2260: quotes_company_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- activities.lead_id -> leads(id) ON DELETE CASCADE (created by 0038; the CASCADE
-- matches its contact_id/deal_id/company_id siblings, see
-- tests/unit/schema/cross-module-links.test.ts)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_lead_id_fkey'
      AND conrelid = 'activities'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "activities" VALIDATE CONSTRAINT "activities_lead_id_fkey";
    RAISE NOTICE '#2260: validated activities_lead_id_fkey';
  ELSE
    RAISE NOTICE '#2260: activities_lead_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- tasks.company_id -> companies(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_company_id_fkey'
      AND conrelid = 'tasks'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_company_id_fkey";
    RAISE NOTICE '#2260: validated tasks_company_id_fkey';
  ELSE
    RAISE NOTICE '#2260: tasks_company_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- tasks.lead_id -> leads(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_lead_id_fkey'
      AND conrelid = 'tasks'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_lead_id_fkey";
    RAISE NOTICE '#2260: validated tasks_lead_id_fkey';
  ELSE
    RAISE NOTICE '#2260: tasks_lead_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- tasks.ticket_id -> support_tickets(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_ticket_id_fkey'
      AND conrelid = 'tasks'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_ticket_id_fkey";
    RAISE NOTICE '#2260: validated tasks_ticket_id_fkey';
  ELSE
    RAISE NOTICE '#2260: tasks_ticket_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- support_tickets.company_id -> companies(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_company_id_fkey'
      AND conrelid = 'support_tickets'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "support_tickets" VALIDATE CONSTRAINT "support_tickets_company_id_fkey";
    RAISE NOTICE '#2260: validated support_tickets_company_id_fkey';
  ELSE
    RAISE NOTICE '#2260: support_tickets_company_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- support_tickets.deal_id -> deals(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_deal_id_fkey'
      AND conrelid = 'support_tickets'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "support_tickets" VALIDATE CONSTRAINT "support_tickets_deal_id_fkey";
    RAISE NOTICE '#2260: validated support_tickets_deal_id_fkey';
  ELSE
    RAISE NOTICE '#2260: support_tickets_deal_id_fkey already valid or absent, skipped';
  END IF;
END $$;
--> statement-breakpoint

-- support_tickets.lead_id -> leads(id) ON DELETE SET NULL (created by 0038)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_lead_id_fkey'
      AND conrelid = 'support_tickets'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "support_tickets" VALIDATE CONSTRAINT "support_tickets_lead_id_fkey";
    RAISE NOTICE '#2260: validated support_tickets_lead_id_fkey';
  ELSE
    RAISE NOTICE '#2260: support_tickets_lead_id_fkey already valid or absent, skipped';
  END IF;
END $$;

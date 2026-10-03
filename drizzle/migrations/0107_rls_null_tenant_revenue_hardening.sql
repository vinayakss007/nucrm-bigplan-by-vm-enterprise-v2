-- 0107: close the NULL-tenant RLS gap on the five revenue tables (#2234).
--
-- WHY
-- ---
-- `0037_tenant_isolation_hardening` gives
--   invoice_line_items, order_line_items, invoice_payments, quote_line_items,
--   deal_stages
-- a `tenant_id` column backfilled from the parent row, but only constrains it
-- NOT NULL + FK when the backfill left zero NULLs (0037:71-113 — on orphan rows
-- it emitted a RAISE WARNING and deliberately left the column NULLABLE). On
-- every live DB where that WARNING fired, `0039_rls_fail_closed_policy` then
-- recreated `tenant_isolation` FOR ALL as
--   USING (tenant_id IS NULL OR tenant_id = current_setting(...))
-- with NO WITH CHECK. That shape has two exploitable properties:
--
--   1. a NULL-tenant line-item/payment/stage row is readable by EVERY tenant
--      (the `tenant_id IS NULL` branch admits any row, in any context);
--   2. without WITH CHECK the USING expression is the INSERT/UPDATE check, and
--      it admits `tenant_id IS NULL` — so any tenant context can poison the
--      revenue chain with un-attributable rows.
--
-- No later migration restates a strict policy for these five (verified: 0 hits
-- for these tables in 0060/0088/0090), while the Drizzle schema TS declares
-- tenant_id NOT NULL for all of them — silent schema/policy drift.
--
-- SHAPE OF THE FIX
-- ----------------
-- Mirrors `0088_rls_bootstrap_and_isolation` exactly:
--
--   (a) backfill tenant_id from the parent row
--       (invoice_line_items/invoice_payments -> invoices, order_line_items ->
--       orders, quote_line_items -> quotes, deal_stages -> pipelines);
--   (b) FAIL LOUDLY if any row still cannot be attributed — RAISE EXCEPTION
--       with the offending count, never a silent delete and never the 0037
--       "leave it NULLABLE" WARNING that created this gap;
--   (c) SET NOT NULL + restore the FK to tenants(id) ON DELETE CASCADE;
--   (d) DROP + CREATE `tenant_isolation` FOR ALL with
--       USING  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
--       WITH CHECK (same expression)
--       — the strict tenant-match form 0088 introduced for usage_alerts and
--       hierarchy_permissions. NULLIF keeps an empty/unset GUC fail-closed
--       (filters, never aborts with 22P02), and WITH CHECK closes the
--       INSERT/UPDATE-to-NULL poisoning path. ENABLE + FORCE ROW LEVEL
--       SECURITY are restated first so the policy is guaranteed active even on
--       a DB where 0037's loop or a manual NO FORCE skipped these tables.
--
-- No super-admin bypass OR-branch is added, and none existed before: the 0039
-- USING admitted only NULL-tenant rows and parent-matched rows under a tenant
-- GUC, so a platform context (app.current_tenant = the nil-UUID sentinel) never
-- saw real tenant rows here. A cross-tenant revenue read stays a deliberate
-- follow-up with its own policy, exactly as 0088 did for pure tenant tables.
--
-- IDEMPOTENCY
-- -----------
-- Safe to re-run everywhere, including the CI path where drizzle-kit push
-- already created tenant_id NOT NULL + FK and 0037/0039 replayed on top: the
-- backfill matches zero rows, NOT NULL/FK are guarded by catalogue checks, and
-- Postgres has no CREATE POLICY IF NOT EXISTS so every policy below is
-- DROP IF EXISTS + CREATE (a tolerated duplicate_object would keep the OLD
-- definition — see the 0088 header for why that matters).

-- ── (a)+(b)+(c): backfill, fail loudly, constrain ──────────────────────────

--> statement-breakpoint
DO $$
DECLARE
  spec record;
  nulls bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('invoice_line_items', 'invoice_id',  'invoices'),
      ('order_line_items',   'order_id',    'orders'),
      ('invoice_payments',   'invoice_id',  'invoices'),
      ('quote_line_items',   'quote_id',    'quotes'),
      ('deal_stages',        'pipeline_id', 'pipelines')
    ) AS t(table_name, parent_col, parent_table)
  LOOP
    -- Skip cleanly if the table itself is absent in this deployment.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = spec.table_name
    );

    -- Defensive: 0037 added the column; if it never ran here, add it now so
    -- the rest of this migration has something to backfill and constrain.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.table_name
        AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id uuid', spec.table_name);
    END IF;

    -- (a) Backfill from the parent row. No-op when the column is already
    -- NOT NULL (a fresh pushed schema or a DB where 0037's happy path ran).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.table_name
        AND column_name = spec.parent_col
    ) AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = spec.parent_table
    ) THEN
      EXECUTE format(
        'UPDATE %I c SET tenant_id = p.tenant_id FROM %I p WHERE c.%I = p.id AND c.tenant_id IS NULL',
        spec.table_name, spec.parent_table, spec.parent_col
      );
    END IF;

    -- (b) Fail loudly. A NULL here means the row's parent no longer exists
    -- (or never did): it cannot be attributed to any tenant, so it must be
    -- reassign- or delete-ed by a human decision, not by this migration and
    -- not by leaving the column NULLABLE the way 0037 did.
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', spec.table_name)
      INTO nulls;
    IF nulls > 0 THEN
      RAISE EXCEPTION
        '0107 (#2234): % row(s) in % still have tenant_id IS NULL after backfill from %.% — these rows cannot be attributed to a tenant. Reassign them to the correct parent (or delete them deliberately), then re-run.',
        nulls, spec.table_name, spec.table_name, spec.parent_col;
    END IF;

    -- (c) SET NOT NULL — matching the Drizzle schema (utils.tenantId()), only
    -- when the catalogue says it is not already in force.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = spec.table_name
        AND a.attname = 'tenant_id' AND a.attnotnull AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', spec.table_name);
    END IF;

    -- (c) FK to tenants — only when NO single-column FK exists on tenant_id.
    -- (Checked by column, not by name, because drizzle-kit push / 0037 may
    -- have created it under this exact name or a different one.)
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c     ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = spec.table_name
        AND con.contype = 'f'
        AND con.conkey[1] = (
          SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = con.conrelid AND a.attname = 'tenant_id' AND a.attnum > 0
        )
        AND con.conkey[2] IS NULL
    ) THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
          spec.table_name, spec.table_name || '_tenant_id_fkey'
        );
        RAISE NOTICE '0107: %: restored tenant_id FK to tenants', spec.table_name;
      EXCEPTION
        WHEN duplicate_object THEN
          RAISE NOTICE '0107: %: tenant_id FK already present under another definition', spec.table_name;
      END;
    END IF;

    -- Support index for the new policy predicate (same names as 0037).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)',
      'idx_' || spec.table_name || '_tenant', spec.table_name
    );
  END LOOP;
END $$;

-- ── (d): strict tenant_isolation FOR ALL + WITH CHECK, 0088 style ───────────

--> statement-breakpoint
ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invoice_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_line_items" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
ALTER TABLE "order_line_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_line_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "order_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_line_items" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invoice_payments";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_payments" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quote_line_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "quote_line_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_line_items" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
ALTER TABLE "deal_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_stages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "deal_stages";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deal_stages" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

-- Migration ID: 0043_tenant_isolation_hardening
-- Name: Repair row-level security and add referential integrity to the revenue chain
-- Dependencies: 0042_backup_records_checksum

-- WHY THIS EXISTS
-- ---------------
-- Migration 0034 enables RLS on 164 tables inside a single DO block. Five of the
-- listed tables cannot accept its policy:
--
--   deal_stages, invoice_line_items, invoice_payments, order_line_items
--       -> no tenant_id column at all
--   super_admin_audit_logs
--       -> tenant_id is TEXT, so `tenant_id = current_setting(...)::uuid`
--          raises "operator does not exist: text = uuid"
--
-- The loop guards table existence but not column existence, and has no EXCEPTION
-- handler, so the first of these aborts the whole block. Because it is one
-- DO block in one transaction, the abort rolls everything back: none of the 164
-- tables end up with RLS. Only the 12 tables from 0012 are protected.
--
-- This migration is written to be idempotent and safe to re-run.

-- UP Migration
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — Give the revenue tables a tenant_id so they CAN be isolated
-- ─────────────────────────────────────────────────────────────────────────────
-- These are child rows of a tenant-scoped parent, so the value is derivable.
-- Backfill first, then constrain. quote_line_items is included even though 0034
-- never listed it, because it has the same exposure.

ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE order_line_items   ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE invoice_payments   ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE quote_line_items   ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE deal_stages        ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- A quote line could only reference a product, while invoice_line_items and
-- order_line_items both carry product_id + service_id + item_type. A service was
-- therefore impossible to quote, and quote -> invoice conversion hardcoded
-- item_type = 'product', relabelling every service line. Align the three tables.
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS service_id uuid;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product';

UPDATE invoice_line_items li SET tenant_id = i.tenant_id
  FROM invoices i WHERE li.invoice_id = i.id AND li.tenant_id IS NULL;

UPDATE order_line_items oli SET tenant_id = o.tenant_id
  FROM orders o WHERE oli.order_id = o.id AND oli.tenant_id IS NULL;

UPDATE invoice_payments p SET tenant_id = i.tenant_id
  FROM invoices i WHERE p.invoice_id = i.id AND p.tenant_id IS NULL;

UPDATE quote_line_items qli SET tenant_id = q.tenant_id
  FROM quotes q WHERE qli.quote_id = q.id AND qli.tenant_id IS NULL;

UPDATE deal_stages ds SET tenant_id = p.tenant_id
  FROM pipelines p WHERE ds.pipeline_id = p.id AND ds.tenant_id IS NULL;

COMMIT;


BEGIN;

-- Constrain to NOT NULL only when the backfill left no gaps. A row with a NULL
-- tenant_id here means it references a parent that no longer exists (see PART 2
-- for why that was possible). Failing the whole migration on pre-existing
-- garbage would block the security fix, so report it and leave the column
-- nullable for manual cleanup instead.
DO $$
DECLARE
  spec record;
  orphans bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('invoice_line_items', 'invoice_id'),
      ('order_line_items',   'order_id'),
      ('invoice_payments',   'invoice_id'),
      ('quote_line_items',   'quote_id'),
      ('deal_stages',        'pipeline_id')
    ) AS t(table_name, parent_col)
  LOOP
    -- Nested block so one table's failure cannot abort the rest. This is exactly
    -- the property 0034 was missing.
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', spec.table_name)
        INTO orphans;

      IF orphans = 0 THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', spec.table_name);
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id)
             REFERENCES tenants(id) ON DELETE CASCADE',
          spec.table_name, spec.table_name || '_tenant_id_fkey'
        );
        RAISE NOTICE '%: tenant_id backfilled and constrained NOT NULL', spec.table_name;
      ELSE
        RAISE WARNING
          '%: % row(s) have a NULL tenant_id because %.% points at a missing parent. '
          'Column left NULLABLE. Clean these up, then run: '
          'ALTER TABLE % ALTER COLUMN tenant_id SET NOT NULL;',
          spec.table_name, orphans, spec.table_name, spec.parent_col, spec.table_name;
      END IF;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '%: tenant_id constraint already present', spec.table_name;
      WHEN others THEN
        RAISE WARNING '%: could not constrain tenant_id (%)', spec.table_name, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_tenant ON invoice_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_tenant   ON order_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant   ON invoice_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_tenant   ON quote_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deal_stages_tenant        ON deal_stages(tenant_id);

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — Referential integrity for the quote -> order -> invoice -> payment chain
-- ─────────────────────────────────────────────────────────────────────────────
-- None of these columns had a foreign key, so nothing stopped an invoice from
-- pointing at a deleted quote, a line item from pointing at no invoice, or a
-- payment from attaching to nothing.
--
-- Constraints are added NOT VALID on purpose: that enforces the rule on every
-- INSERT and UPDATE from now on, without scanning (and potentially failing on)
-- rows that pre-date the constraint. Existing rows are checked separately by
-- `npm run db:validate-constraints`, which runs VALIDATE CONSTRAINT once the
-- data has been cleaned. Doing it in one step would either lock these tables for
-- a full scan or abort the migration on legacy garbage.

BEGIN;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      -- child table,          column,              parent,     on delete
      ('invoices',           'quote_id',          'quotes',   'SET NULL'),
      ('invoices',           'order_id',          'orders',   'SET NULL'),
      ('invoices',           'parent_invoice_id', 'invoices', 'SET NULL'),
      ('orders',             'quote_id',          'quotes',   'SET NULL'),
      ('orders',             'invoice_id',        'invoices', 'SET NULL'),
      ('invoice_line_items', 'invoice_id',        'invoices', 'CASCADE'),
      ('invoice_line_items', 'product_id',        'products', 'SET NULL'),
      ('invoice_line_items', 'service_id',        'services', 'SET NULL'),
      ('order_line_items',   'order_id',          'orders',   'CASCADE'),
      ('order_line_items',   'product_id',        'products', 'SET NULL'),
      ('order_line_items',   'service_id',        'services', 'SET NULL'),
      ('invoice_payments',   'invoice_id',        'invoices', 'CASCADE'),
      ('quote_line_items',   'service_id',        'services', 'SET NULL')
    ) AS t(child, col, parent, on_delete)
  LOOP
    BEGIN
      -- Skip if the column or parent table is absent in this deployment.
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = fk.child AND column_name = fk.col
      ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = fk.parent
      ) THEN
        RAISE NOTICE 'skip %.% -> % (column or parent table missing)', fk.child, fk.col, fk.parent;
        CONTINUE;
      END IF;

      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES %I(id) ON DELETE %s NOT VALID',
        fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent, fk.on_delete
      );
      RAISE NOTICE 'added %.% -> %(id) ON DELETE %', fk.child, fk.col, fk.parent, fk.on_delete;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '%.% foreign key already present', fk.child, fk.col;
      WHEN others THEN
        RAISE WARNING 'could not add %.% -> % (%)', fk.child, fk.col, fk.parent, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_quote          ON invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order          ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_quote            ON orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 — Apply RLS to every tenant-scoped table, defensively
-- ─────────────────────────────────────────────────────────────────────────────
-- Differences from 0034, each one a failure it hit:
--
--   1. Discovers tables from the catalogue instead of a hand-maintained array,
--      so the list cannot drift from the schema again.
--   2. Requires tenant_id to exist AND be of type uuid, which skips
--      super_admin_audit_logs (text tenant_id) instead of aborting on it.
--   3. Wraps each table in its own block, so one failure costs one table.
--   4. Emits `tenant_id IS NULL` in the USING clause ONLY where the column is
--      actually nullable. 0034 emitted it unconditionally, which means any row
--      with a NULL tenant_id is readable by EVERY tenant. Tables whose
--      tenant_id is NOT NULL now get the strict policy.

BEGIN;

DO $$
DECLARE
  rec record;
  using_expr text;
  applied int := 0;
  skipped int := 0;
BEGIN
  FOR rec IN
    SELECT c.relname AS table_name, a.attnotnull AS tenant_not_null
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      JOIN pg_type ty     ON ty.oid = a.atttypid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND a.attname = 'tenant_id'
       AND a.attisdropped = false
       AND ty.typname = 'uuid'          -- excludes text tenant_id columns
     ORDER BY c.relname
  LOOP
    BEGIN
      -- platform_settings legitimately stores global rows with a NULL tenant_id
      -- that every tenant must be able to read.
      IF rec.tenant_not_null AND rec.table_name <> 'platform_settings' THEN
        using_expr := 'tenant_id = current_setting(''app.current_tenant'')::uuid';
      ELSE
        using_expr := 'tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant'')::uuid';
      END IF;

      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.table_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL
           USING (%s)
           WITH CHECK (tenant_id = current_setting(''app.current_tenant'')::uuid)',
        rec.table_name, using_expr
      );
      applied := applied + 1;
    EXCEPTION
      WHEN others THEN
        skipped := skipped + 1;
        RAISE WARNING 'RLS skipped for % (%)', rec.table_name, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'RLS applied to % table(s), skipped %', applied, skipped;

  IF applied = 0 THEN
    RAISE EXCEPTION 'RLS was applied to zero tables — refusing to report success';
  END IF;
END $$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- NOT DONE HERE, ON PURPOSE: FORCE ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL exempts a table's OWNER from its own RLS policies unless the table
-- is marked FORCE ROW LEVEL SECURITY. The application connects as the role that
-- owns these tables, so the policies above are correct and present but inert for
-- the app role. Fixing that requires splitting the connection into two roles:
--
--   nucrm_app    NOT the table owner, no BYPASSRLS -> policies apply
--   nucrm_owner  owns the schema, BYPASSRLS        -> migrations, cron, superadmin
--
-- Turning on FORCE here without that split would immediately break the 28
-- superadmin and cron routes that legitimately read across tenants, so it is
-- deliberately left as a follow-up with a coordinated deploy.
--
-- Run `npm run db:verify-isolation` to see the real state at any time; it
-- reports policy coverage AND whether the connecting role is actually subject
-- to those policies, so this gap cannot be mistaken for protection.

-- DOWN Migration
-- DOWN
BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT tablename FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.tablename);
  END LOOP;
END $$;

ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_invoice_id_fkey;
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_product_id_fkey;
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_service_id_fkey;
ALTER TABLE order_line_items   DROP CONSTRAINT IF EXISTS order_line_items_order_id_fkey;
ALTER TABLE order_line_items   DROP CONSTRAINT IF EXISTS order_line_items_product_id_fkey;
ALTER TABLE order_line_items   DROP CONSTRAINT IF EXISTS order_line_items_service_id_fkey;
ALTER TABLE invoice_payments   DROP CONSTRAINT IF EXISTS invoice_payments_invoice_id_fkey;
ALTER TABLE invoices           DROP CONSTRAINT IF EXISTS invoices_quote_id_fkey;
ALTER TABLE invoices           DROP CONSTRAINT IF EXISTS invoices_order_id_fkey;
ALTER TABLE invoices           DROP CONSTRAINT IF EXISTS invoices_parent_invoice_id_fkey;
ALTER TABLE orders             DROP CONSTRAINT IF EXISTS orders_quote_id_fkey;
ALTER TABLE orders             DROP CONSTRAINT IF EXISTS orders_invoice_id_fkey;

-- tenant_id columns are intentionally NOT dropped: doing so would discard the
-- backfilled values, and a re-run of the UP migration can no longer recover them
-- once the parent rows have moved on.

COMMIT;
-- END DOWN

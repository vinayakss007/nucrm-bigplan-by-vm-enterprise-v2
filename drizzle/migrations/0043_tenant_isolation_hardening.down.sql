-- Rollback for 0043_tenant_isolation_hardening
-- Kept in a separate file: drizzle's migrate() has no concept of a DOWN
-- section and would execute these statements as part of the forward
-- migration, undoing it immediately.
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

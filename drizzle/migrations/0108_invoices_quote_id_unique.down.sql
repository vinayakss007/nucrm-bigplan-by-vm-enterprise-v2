-- 0108 down: drop the per-quote uniqueness guard, returning convert-to-invoice
-- to the pre-#2228 state where concurrent POSTs can insert duplicate invoices
-- for one quote.
DROP INDEX IF EXISTS "uq_invoices_quote_id";

-- 0111: non-negative CHECKs on revenue money columns (#2256).
--
-- WHY
-- ---
-- The live-data audit found 17 numeric money/rate columns across the revenue
-- tables (invoices, quotes, their line items, orders, contracts, leads) that
-- carried NO CHECK at all — so `INSERT INTO invoices (..., subtotal,
-- balance_due) VALUES (..., -99999.99, -50000)` was accepted and negative
-- subtotals/taxes flowed straight into revenue reports. Their sibling columns
-- (total_amount, tax_amount, amount_paid, ...) already got chk_*_nonneg
-- constraints in 0050; this file closes the remaining gaps in the same
-- chk_<table>_<col>_nonneg style.
--
-- PRE-VERIFIED on the migrated dev DB (read-only sweep before writing this
-- file): count(*) WHERE col < 0 = 0 for every column below, and max() for the
-- four percent columns (invoices.tax_rate, invoice_line_items.tax_rate,
-- quote_line_items.tax_percent, quote_line_items.discount_percent) is 0.00 —
-- so both the >= 0 checks and the percent <= 100 ceilings attach without
-- invalidating a single existing row (no NOT VALID needed).
--
-- NOT included: the issue's suggested chk_invoices_paid_lte_total
-- (amount_paid <= total_amount). The payment ledger deliberately supports
-- opt-in overpayment (POST /api/tenant/invoices/:id/payments with
-- allow_overpayment: true, lib/billing/payments.ts recordInvoicePayment), so
-- that CHECK would reject a legitimate flow. Skipped on purpose.
--
-- IDEMPOTENCY: each ADD CONSTRAINT is wrapped in a duplicate_object
-- exception guard, so re-running after a partial apply is a no-op.
-- NULL columns are unaffected either way: a CHECK over NULL evaluates to
-- NULL, which passes — matching the nullable-ness of discount_value etc.

DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_subtotal_nonneg" CHECK ("subtotal" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_balance_due_nonneg" CHECK ("balance_due" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_discount_value_nonneg" CHECK ("discount_value" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_tax_rate_nonneg" CHECK ("tax_rate" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_tax_rate_max100" CHECK ("tax_rate" <= 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_subtotal_nonneg" CHECK ("subtotal" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_tax_nonneg" CHECK ("tax" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_discount_nonneg" CHECK ("discount" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_line_items" ADD CONSTRAINT "chk_invoice_line_items_total_nonneg" CHECK ("total" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_line_items" ADD CONSTRAINT "chk_invoice_line_items_tax_rate_nonneg" CHECK ("tax_rate" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_line_items" ADD CONSTRAINT "chk_invoice_line_items_tax_rate_max100" CHECK ("tax_rate" <= 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_line_items" ADD CONSTRAINT "chk_invoice_line_items_discount_value_nonneg" CHECK ("discount_value" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quote_line_items" ADD CONSTRAINT "chk_quote_line_items_total_nonneg" CHECK ("total" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quote_line_items" ADD CONSTRAINT "chk_quote_line_items_tax_percent_nonneg" CHECK ("tax_percent" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quote_line_items" ADD CONSTRAINT "chk_quote_line_items_tax_percent_max100" CHECK ("tax_percent" <= 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quote_line_items" ADD CONSTRAINT "chk_quote_line_items_discount_percent_nonneg" CHECK ("discount_percent" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "quote_line_items" ADD CONSTRAINT "chk_quote_line_items_discount_percent_max100" CHECK ("discount_percent" <= 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "order_line_items" ADD CONSTRAINT "chk_order_line_items_total_nonneg" CHECK ("total" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_subtotal_nonneg" CHECK ("subtotal" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "contracts" ADD CONSTRAINT "chk_contracts_total_value_nonneg" CHECK ("total_value" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leads" ADD CONSTRAINT "chk_leads_value_nonneg" CHECK ("value" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

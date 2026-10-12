-- 0111 down: drop the non-negative CHECKs added by 0111_money_check_constraints.sql.
-- IF EXISTS keeps this a no-op on DBs where 0111 never applied.
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_subtotal_nonneg";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_balance_due_nonneg";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_discount_value_nonneg";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_tax_rate_nonneg";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_tax_rate_max100";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "chk_quotes_subtotal_nonneg";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "chk_quotes_tax_nonneg";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "chk_quotes_discount_nonneg";
--> statement-breakpoint
ALTER TABLE "invoice_line_items" DROP CONSTRAINT IF EXISTS "chk_invoice_line_items_total_nonneg";
--> statement-breakpoint
ALTER TABLE "invoice_line_items" DROP CONSTRAINT IF EXISTS "chk_invoice_line_items_tax_rate_nonneg";
--> statement-breakpoint
ALTER TABLE "invoice_line_items" DROP CONSTRAINT IF EXISTS "chk_invoice_line_items_tax_rate_max100";
--> statement-breakpoint
ALTER TABLE "invoice_line_items" DROP CONSTRAINT IF EXISTS "chk_invoice_line_items_discount_value_nonneg";
--> statement-breakpoint
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "chk_quote_line_items_total_nonneg";
--> statement-breakpoint
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "chk_quote_line_items_tax_percent_nonneg";
--> statement-breakpoint
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "chk_quote_line_items_tax_percent_max100";
--> statement-breakpoint
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "chk_quote_line_items_discount_percent_nonneg";
--> statement-breakpoint
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "chk_quote_line_items_discount_percent_max100";
--> statement-breakpoint
ALTER TABLE "order_line_items" DROP CONSTRAINT IF EXISTS "chk_order_line_items_total_nonneg";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_subtotal_nonneg";
--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "chk_contracts_total_value_nonneg";
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "chk_leads_value_nonneg";

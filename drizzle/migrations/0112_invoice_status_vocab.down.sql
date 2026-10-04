-- Undo 0112: back to the eight values chk_invoices_status held before #2258.
-- Any invoice still in 'void' makes this fail loudly (23514) rather than
-- silently stranding rows the app can no longer address — void an invoice
-- back to a legal status first.
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_status";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_status"
  CHECK ("status" IN ('draft','sent','paid','overdue','cancelled','partially_paid','written_off','pending'));

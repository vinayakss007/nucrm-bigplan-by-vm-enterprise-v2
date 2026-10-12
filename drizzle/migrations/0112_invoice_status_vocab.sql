-- 0112: chk_invoices_status must accept 'void' (#2258).
--
-- The API vocabulary (createInvoiceSchema/updateInvoiceSchema, PUT
-- /api/tenant/invoices/[id]) and the billing engine both treat 'void' as a
-- terminal invoice state — lib/billing/payments.ts:184 and the PayU webhook
-- (app/api/webhooks/payu/route.ts:163) refuse to record a payment against a
-- 'void' invoice — but chk_invoices_status (0050) never listed it, so that
-- guard was unreachable: a client sending {"status":"void"} passed Zod and
-- died on 23514. Conversely 'refunded' exists only in the Zod enums (a
-- copy-paste from the orders vocabulary — orders genuinely allow it,
-- invoices never did, nothing in the app writes or reads invoice status
-- 'refunded', and refunds are modelled in the invoice_payments ledger, which
-- preserves the invoice status across a refund per #2226). It is removed from
-- Zod instead of being added here, so the API answers a clear 400.
--
-- The resulting canonical vocabulary is exactly INVOICE_STATUSES in
-- lib/api/schemas/billing.ts, mirrored in scripts/constraint-vocab.json:
--   draft, sent, paid, overdue, cancelled, partially_paid,
--   written_off, pending, void
-- written_off/pending were already DB-legal (legacy rows may carry them);
-- they were missing from Zod and are added there, not touched here.
--
-- Widening a CHECK only ADDS an accepted value ('void'), so no existing row
-- can violate the re-added constraint; DROP IF EXISTS + ADD keeps the
-- migration re-runnable on fresh databases that skipped the slot.
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "chk_invoices_status";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_status"
  CHECK ("status" IN ('draft','sent','paid','overdue','cancelled','partially_paid','written_off','pending','void'));

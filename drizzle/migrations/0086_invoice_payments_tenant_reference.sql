-- 0086: DB-level payment idempotency backstop (#1916).
--
-- Payment idempotency relied entirely on application-level SELECT-then-INSERT
-- against invoice_payments.reference. Under concurrent PayU callbacks or a
-- double-submitted manual payment, two writers can both pass the SELECT and
-- insert duplicate ledger rows (double-credit). This partial unique index
-- makes the INSERT itself the arbiter: the loser gets a 23505 violation,
-- which the writers translate into already-processed / 409 responses.
--
-- Partial (not full) by design:
--   * reference IS NOT NULL — manual payments without a reference never collide.
--   * deleted_at IS NULL   — voided (soft-deleted) rows don't block
--     re-recording the same reference.
--
-- Pre-existing duplicates will fail this migration loudly. Find them with:
--   SELECT tenant_id, reference, COUNT(*) FROM invoice_payments
--   WHERE deleted_at IS NULL AND reference IS NOT NULL
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- then void all but one row per group (voidInvoicePayment) and re-run.
--
-- Idempotent: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_payments_tenant_reference"
  ON "invoice_payments" ("tenant_id", "reference")
  WHERE "deleted_at" IS NULL AND "reference" IS NOT NULL;

-- Down migration for 0086: drop the payment idempotency backstop index.
DROP INDEX IF EXISTS "uq_invoice_payments_tenant_reference";

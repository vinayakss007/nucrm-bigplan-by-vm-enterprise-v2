-- Migration: Add missing foreign key constraints and tenantId columns
-- Fixes #414: billing sub-tables missing FK and tenant isolation

-- ── invoice_line_items ──────────────────────────────────────────────
-- Add tenantId column (nullable first for backfill)
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Add FK to invoices
ALTER TABLE invoice_line_items
  ADD CONSTRAINT fk_invoice_line_items_invoice
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

-- Add FK to tenant (backfill from parent invoice, then enforce)
UPDATE invoice_line_items ili
   SET tenant_id = i.tenant_id
  FROM invoices i
 WHERE ili.invoice_id = i.id
   AND ili.tenant_id IS NULL;

ALTER TABLE invoice_line_items
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE invoice_line_items
  ADD CONSTRAINT fk_invoice_line_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_tenant
  ON invoice_line_items(tenant_id);

-- ── invoice_payments ────────────────────────────────────────────────
-- Add tenantId column
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Add FK to invoices
ALTER TABLE invoice_payments
  ADD CONSTRAINT fk_invoice_payments_invoice
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

-- Add FK to recorded_by user
ALTER TABLE invoice_payments
  ADD CONSTRAINT fk_invoice_payments_recorded_by
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL;

-- Backfill tenant_id from parent invoice
UPDATE invoice_payments ip
   SET tenant_id = i.tenant_id
  FROM invoices i
 WHERE ip.invoice_id = i.id
   AND ip.tenant_id IS NULL;

ALTER TABLE invoice_payments
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE invoice_payments
  ADD CONSTRAINT fk_invoice_payments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant
  ON invoice_payments(tenant_id);

-- ── order_line_items ────────────────────────────────────────────────
-- Add tenantId column
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Add FK to orders
ALTER TABLE order_line_items
  ADD CONSTRAINT fk_order_line_items_order
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- Backfill tenant_id from parent order
UPDATE order_line_items oli
   SET tenant_id = o.tenant_id
  FROM orders o
 WHERE oli.order_id = o.id
   AND oli.tenant_id IS NULL;

ALTER TABLE order_line_items
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE order_line_items
  ADD CONSTRAINT fk_order_line_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_order_line_items_tenant
  ON order_line_items(tenant_id);

-- ── service_subscriptions ───────────────────────────────────────────
-- Add FK constraints for contactId and companyId
ALTER TABLE service_subscriptions
  ADD CONSTRAINT fk_service_subscriptions_contact
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE service_subscriptions
  ADD CONSTRAINT fk_service_subscriptions_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- ── documents.uploaded_by ───────────────────────────────────────────
-- Add FK constraint for uploadedBy
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;

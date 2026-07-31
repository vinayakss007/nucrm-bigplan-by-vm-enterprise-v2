-- Rollback 0033_add_fk_constraints_billing_documents: Drop FK constraints
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_tenant_id_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_contact_id_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_deal_id_fk;
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_invoice_id_fk;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_tenant_id_fk;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_folder_id_fk;

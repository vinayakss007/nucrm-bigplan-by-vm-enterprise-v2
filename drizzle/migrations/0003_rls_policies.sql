-- NuCRM: Row-Level Security Policies
-- These enforce multi-tenant isolation at the database level.
-- Run after schema migration.

-- Enable RLS on all tenant-scoped tables
-- Core CRM
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Billing
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Support
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;

-- Knowledge Base
ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

-- Automation
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

-- Communication
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Each policy restricts access to rows where tenant_id matches the session variable

-- Companies
CREATE POLICY tenant_isolation ON companies
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Contacts
CREATE POLICY tenant_isolation ON contacts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Leads
CREATE POLICY tenant_isolation ON leads
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Deals
CREATE POLICY tenant_isolation ON deals
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Tasks
CREATE POLICY tenant_isolation ON tasks
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Activities
CREATE POLICY tenant_isolation ON activities
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Notes
CREATE POLICY tenant_isolation ON notes
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Meetings
CREATE POLICY tenant_isolation ON meetings
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Invoices
CREATE POLICY tenant_isolation ON invoices
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Support Tickets
CREATE POLICY tenant_isolation ON support_tickets
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- KB Categories
CREATE POLICY tenant_isolation ON kb_categories
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- KB Articles
CREATE POLICY tenant_isolation ON kb_articles
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Integrations
CREATE POLICY tenant_isolation ON integrations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- NuCRM: Add missing database indexes for query performance
-- These indexes target the most common query patterns found in the codebase audit.

-- 1. Contacts: assigned_to (used in every non-admin query), createdAt (sort)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_assigned_to ON contacts(tenant_id, assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_created_at ON contacts(tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_email_active ON contacts(tenant_id, email) WHERE deleted_at IS NULL;

-- 2. Leads: assigned_to, createdAt, email with tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_assigned_to ON leads(tenant_id, assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_created_at ON leads(tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_email ON leads(tenant_id, email);

-- 3. Deals: assigned_to, pipelineId, createdAt, (tenantId, stageId)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_assigned_to ON deals(tenant_id, assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_pipeline_id ON deals(tenant_id, pipeline_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_created_at ON deals(tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_stage ON deals(tenant_id, stage_id);

-- 4. Tasks: tenantId + dueDate, assigned_to
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_due_date ON tasks(tenant_id, due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to ON tasks(tenant_id, assigned_to);

-- 5. Activities: (tenantId, contactId, createdAt DESC) for timeline queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_contact_timeline ON activities(tenant_id, contact_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);

-- 6. Notifications: (userId, readAt, createdAt) for unread queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_all ON notifications(user_id, created_at DESC);

-- 7. EditHistory (field snapshots): (entityType, entityId, createdAt DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_edit_history_entity ON edit_history(entity_type, entity_id, created_at DESC);

-- 8. Invoices: tenant + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_due_date ON invoices(tenant_id, due_date);

-- 9. Full-text search indexes for contacts and companies
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_full_text ON contacts
  USING gin(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_full_text ON companies
  USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(industry, '')));

-- 10. Partial active indexes (deleted_at IS NULL) for common filtered queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_active ON leads(id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_active ON deals(id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_active ON tasks(id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_active ON tickets(id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_active ON invoices(id) WHERE deleted_at IS NULL;

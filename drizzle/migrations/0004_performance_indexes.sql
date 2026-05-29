-- NuCRM Performance Optimization Indexes
-- For handling millions of records across multiple tenants
-- Generated: 2026-05-11

-- =============================================================================
-- LEADS INDEXES - Critical for lead management at scale
-- =============================================================================

-- Composite index for tenant-filtered lead queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_created 
  ON leads(tenant_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Email lookup (case-insensitive search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_email_lower 
  ON leads(lower(email)) 
  WHERE deleted_at IS NULL AND email IS NOT NULL;

-- Status filtering by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_status 
  ON leads(tenant_id, lead_status) 
  WHERE deleted_at IS NULL;

-- Assigned leads by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_assigned 
  ON leads(assigned_to, tenant_id) 
  WHERE deleted_at IS NULL;

-- Lead source analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_source 
  ON leads(tenant_id, lead_source) 
  WHERE deleted_at IS NULL;

-- Full-text search index for lead names (removed - requires IMMUTABLE functions)

-- =============================================================================
-- CONTACTS INDEXES - Critical for contact management
-- =============================================================================

-- Tenant-filtered contact queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_created 
  ON contacts(tenant_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Email lookup (case-insensitive)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_email_lower 
  ON contacts(lower(email)) 
  WHERE deleted_at IS NULL AND email IS NOT NULL;

-- Company-based contact grouping
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company 
  ON contacts(company_id, tenant_id) 
  WHERE deleted_at IS NULL;

-- Assigned contacts by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_assigned 
  ON contacts(assigned_to, tenant_id) 
  WHERE deleted_at IS NULL;

-- Contact status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_status 
  ON contacts(tenant_id, lead_status) 
  WHERE deleted_at IS NULL;

-- Lifecycle stage analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_lifecycle 
  ON contacts(tenant_id, lifecycle_stage) 
  WHERE deleted_at IS NULL;

-- =============================================================================
-- DEALS INDEXES - Critical for sales pipeline
-- =============================================================================

-- Tenant-filtered deal queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_created 
  ON deals(tenant_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Pipeline stage filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_stage 
  ON deals(tenant_id, stage_id) 
  WHERE deleted_at IS NULL;

-- Assigned deals by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_assigned 
  ON deals(assigned_to, tenant_id) 
  WHERE deleted_at IS NULL;

-- Pipeline-based deals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_pipeline 
  ON deals(tenant_id, pipeline_id) 
  WHERE deleted_at IS NULL;

-- Contact-linked deals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_contact 
  ON deals(contact_id, tenant_id) 
  WHERE deleted_at IS NULL;

-- Amount-based sorting (for pipeline value)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_amount 
  ON deals(tenant_id, (amount::numeric)) 
  WHERE deleted_at IS NULL AND amount IS NOT NULL;

-- =============================================================================
-- COMPANIES INDEXES
-- =============================================================================

-- Tenant-filtered company queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_tenant_created 
  ON companies(tenant_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Domain-based company lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_domain 
  ON companies(tenant_id, lower(domain)) 
  WHERE deleted_at IS NULL AND domain IS NOT NULL;

-- Industry segmentation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_industry 
  ON companies(tenant_id, industry) 
  WHERE deleted_at IS NULL;

-- =============================================================================
-- TASKS INDEXES
-- =============================================================================

-- Tenant-filtered task queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_created 
  ON tasks(tenant_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Due date sorting (for overdue task queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_due_date 
  ON tasks(tenant_id, due_date) 
  WHERE deleted_at IS NULL AND due_date IS NOT NULL;

-- Task assignment
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned 
  ON tasks(assigned_to, tenant_id) 
  WHERE deleted_at IS NULL;

-- Contact-linked tasks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_contact 
  ON tasks(contact_id, tenant_id) 
  WHERE deleted_at IS NULL;

-- Deal-linked tasks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_deal 
  ON tasks(deal_id, tenant_id) 
  WHERE deleted_at IS NULL;

-- Task status filtering (open tasks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_open 
  ON tasks(tenant_id, completed) 
  WHERE deleted_at IS NULL AND completed = false;

-- =============================================================================
-- ACTIVITIES INDEXES - For activity timeline
-- =============================================================================

-- Tenant-filtered activity queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_tenant_created 
  ON activities(tenant_id, created_at DESC);

-- Entity-based activity queries (for timelines)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_entity 
  ON activities(tenant_id, entity_type, entity_id, created_at DESC);

-- Contact activity timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_contact 
  ON activities(tenant_id, contact_id, created_at DESC);

-- Deal activity timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_deal 
  ON activities(tenant_id, deal_id, created_at DESC);

-- User activity tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_user 
  ON activities(tenant_id, user_id, created_at DESC);

-- =============================================================================
-- AUDIT LOGS INDEXES - For security and compliance
-- =============================================================================

-- Tenant-filtered audit queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_created 
  ON audit_logs(tenant_id, created_at DESC);

-- User action tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user 
  ON audit_logs(tenant_id, user_id, created_at DESC);

-- Resource-based audit queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_resource 
  ON audit_logs(tenant_id, entity_type, entity_id, created_at DESC);

-- Action type filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action 
  ON audit_logs(tenant_id, action, created_at DESC);

-- =============================================================================
-- LEAD ACTIVITIES INDEXES
-- =============================================================================

-- Tenant-filtered lead activity queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_tenant_created 
  ON lead_activities(tenant_id, created_at DESC);

-- Lead activity timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_lead 
  ON lead_activities(tenant_id, lead_id, created_at DESC);

-- Activity type filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_type 
  ON lead_activities(tenant_id, activity_type, created_at DESC);

-- =============================================================================
-- SEQUENCES INDEXES - For email campaigns
-- =============================================================================

-- Active enrollments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequence_enrollments_active 
  ON sequence_enrollments(tenant_id, status) 
  WHERE status = 'active';

-- Contact enrollment lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequence_enrollments_contact 
  ON sequence_enrollments(tenant_id, contact_id) 
  WHERE status = 'active';

-- Next step scheduling
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequence_enrollments_next 
  ON sequence_enrollments(tenant_id, next_step_at) 
  WHERE status = 'active' AND next_step_at IS NOT NULL;

-- =============================================================================
-- NOTIFICATIONS INDEXES
-- =============================================================================

-- User unread notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread 
  ON notifications(user_id, tenant_id) 
  WHERE read_at IS NULL;

-- Recent notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recent 
  ON notifications(user_id, created_at DESC) 
  WHERE read_at IS NULL;

-- =============================================================================
-- SESSIONS INDEXES - For session management
-- =============================================================================

-- Active sessions by user (removed - now() is not IMMUTABLE)
-- Session token lookup (removed - now() is not IMMUTABLE)

-- =============================================================================
-- API KEY USAGE INDEXES - For rate limiting and billing
-- =============================================================================

-- API key usage tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_usage_key 
  ON api_key_usage(api_key_id, created_at DESC);

-- Tenant API usage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_usage_tenant 
  ON api_key_usage(tenant_id, created_at DESC);

-- =============================================================================
-- CLEANUP: Remove unused indexes if they exist
-- =============================================================================

-- Drop indexes that may conflict (run only if needed)
-- DROP INDEX IF EXISTS idx_deals_stage;  -- May conflict with existing stage index

-- =============================================================================
-- ANALYZE TABLES FOR QUERY OPTIMIZER
-- =============================================================================

-- Run analyze after creating indexes
ANALYZE VERBOSE leads;
ANALYZE VERBOSE contacts;
ANALYZE VERBOSE deals;
ANALYZE VERBOSE companies;
ANALYZE VERBOSE tasks;
ANALYZE VERBOSE activities;
ANALYZE VERBOSE audit_logs;
ANALYZE VERBOSE lead_activities;
ANALYZE VERBOSE sequence_enrollments;
ANALYZE VERBOSE notifications;
ANALYZE VERBOSE sessions;
ANALYZE VERBOSE api_key_usage;
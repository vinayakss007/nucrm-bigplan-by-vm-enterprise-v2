-- RLS Policies for Tenant Isolation
-- Enables Row-Level Security on critical tables and creates policies
-- using app.current_tenant session variable set by requireAuth()

-- Helper: enable RLS and create tenant-scoped policy
DO $$
DECLARE
  tables text[] := ARRAY[
    'contacts', 'companies', 'deals', 'tasks', 'activities',
    'notes', 'meetings', 'automations', 'notifications',
    'webhook_deliveries', 'api_keys', 'audit_logs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('
      DROP POLICY IF EXISTS tenant_isolation ON %I;
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (tenant_id = current_setting(''app.current_tenant'')::uuid)
        WITH CHECK (tenant_id = current_setting(''app.current_tenant'')::uuid);
    ', t, t);
  END LOOP;
END $$;

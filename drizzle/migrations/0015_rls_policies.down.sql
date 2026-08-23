-- Down Migration: 0015_rls_policies
-- Removes tenant_isolation policies and disables RLS on the covered tables

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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

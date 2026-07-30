-- Fix RLS policies: use safe current_setting() with fallback to handle missing session variable

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
    EXECUTE format('
      DROP POLICY IF EXISTS tenant_isolation ON %I;
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)
        WITH CHECK (tenant_id = current_setting(''app.current_tenant'', true)::uuid);
    ', t, t);
  END LOOP;
END $$;

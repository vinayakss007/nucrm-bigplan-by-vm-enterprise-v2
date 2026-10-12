-- 0092: super-admin bypass for platform-observed tables.
--
-- /api/metrics (Prometheus) counts platform-wide rows under the super-admin
-- GUC with no tenant. Tables without a bypass silently count 0 (NUCRM-1/F
-- noise aside, every gauge was wrong). Add the same ORed bypass used by
-- backup_schedules/tenants: tenant match still admits scoped requests.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'leads', 'deals', 'companies',
    'tasks', 'activities', 'deal_stages', 'pipelines'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I;', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I FOR ALL USING ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      'OR ((NULLIF(current_setting(''app.is_super_admin'', true), ''''))::boolean = true)'
      ') WITH CHECK ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      'OR ((NULLIF(current_setting(''app.is_super_admin'', true), ''''))::boolean = true)'
      ');', t);
  END LOOP;
END $$;

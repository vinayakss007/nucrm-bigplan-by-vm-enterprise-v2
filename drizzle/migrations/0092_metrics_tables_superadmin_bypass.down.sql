-- 0092 down: restore the fail-closed tenant-only policies (0039 form).
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
      'CREATE POLICY tenant_isolation ON %I '
      'FOR ALL '
      'USING ('
      '  tenant_id IS NULL '
      '  OR tenant_id = ( '
      '    CASE '
      '      WHEN NULLIF(current_setting(''app.current_tenant'', true), '''') IS NULL THEN NULL '
      '      ELSE NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid '
      '    END '
      '  ) '
      ');', t);
  END LOOP;
END $$;

-- Down Migration: 0039_rls_fail_closed_policy
-- Restores the original strict-cast tenant_isolation policy from 0015/0031.
-- NOTE: reverting re-introduces the crash-on-empty-GUC behavior that 0039 fixed.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_name = c.relname
          AND col.table_schema = 'public'
          AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'FOR ALL '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'')) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant''))',
      t
    );
  END LOOP;
END $$;

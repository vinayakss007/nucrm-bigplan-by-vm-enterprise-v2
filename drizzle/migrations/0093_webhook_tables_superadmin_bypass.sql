-- 0093: super-admin bypass for the webhook platform tables.
--
-- The retry-webhooks cron scans webhook_queue cross-tenant and purges
-- dead_letter_queue. Neither admitted the super-admin context, so the retry
-- scan silently saw zero rows and the purge died with an RLS violation
-- (NUCRM-A). Tenant isolation for ordinary requests is unchanged.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_queue', 'dead_letter_queue'] LOOP
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

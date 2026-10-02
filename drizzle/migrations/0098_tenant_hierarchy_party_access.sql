-- 0098: let a tenant admin manage a hierarchy link they are a party to.
--
-- NOT APPLIED — this widens RLS and needs explicit approval. Run with
-- `npm run db:migrate` once approved.
--
-- tenant_hierarchy is a (parent_tenant_id, child_tenant_id) pair with no
-- tenant_id column, so the standard tenant_isolation template cannot cover it,
-- and the table carries only `tenant_hierarchy_super_admin_only`
-- (USING app.is_super_admin, FOR ALL). RLS is enabled AND forced on this table,
-- so for a non-super-admin every statement on it is filtered to zero rows:
--
--   POST   /api/tenant/hierarchy -> 42501 -> the settings page shows a bare 500
--   GET    /api/tenant/hierarchy -> always an empty list, even after a link that
--          was created by the super admin panel, so the customer cannot see the
--          hierarchy they belong to
--   PUT/DELETE                   -> match 0 rows, silently a no-op
--
-- The grant below is scoped to the requesting tenant being on either side of the
-- link — it does not expose other tenants' relationships, and it is PERMISSIVE,
-- so it is OR-ed with the existing super-admin policy and the panel keeps
-- working exactly as before.
CREATE POLICY "tenant_hierarchy_party_access" ON "tenant_hierarchy"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    parent_tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid
    OR child_tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid
  )
  WITH CHECK (
    parent_tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid
    OR child_tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid
  );

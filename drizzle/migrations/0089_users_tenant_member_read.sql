-- 0089: let active tenant members read fellow members' user rows.
--
-- The `users` table only had read_self + super_admin_read SELECT policies.
-- Every tenant route that joins users (members list, assignee names on
-- contacts/deals/tasks/tickets, audit log authors, call/meeting owners …)
-- silently returned NULLs (LEFT JOIN) or dropped rows (INNER JOIN) for
-- anyone but the requester: the team list showed only yourself, assignee
-- columns were blank, and member PATCH lookups 404'd on other members.
--
-- This policy admits SELECT on a user row when the requester shares any
-- tenant with them through two ACTIVE memberships. Cross-tenant reads stay
-- closed (the join pins both sides to the same tenant_id); writes are
-- untouched.
DROP POLICY IF EXISTS "users_tenant_member_read" ON "users";
--> statement-breakpoint
CREATE POLICY "users_tenant_member_read" ON "users" FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM tenant_members tm_self
    JOIN tenant_members tm_other ON tm_other.tenant_id = tm_self.tenant_id
    WHERE tm_self.user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
      AND tm_self.status = 'active'
      AND tm_other.user_id = users.id
      AND tm_other.status = 'active'
  )
);

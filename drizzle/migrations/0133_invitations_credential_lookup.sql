/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0133: a read path for team-invitation acceptance (#3182).
--
-- `invitations` carries one policy, `tenant_isolation`, on a table whose tenant is
-- exactly the thing the route cannot know before it has read the row. The flow is
-- "a signed-in user presents a token, and the token names the workspace" — so the
-- only context available at read time is the credential, and the only context the
-- code has is none:
--
--   app/api/auth/accept-invite/route.ts   reads invitations ⋈ tenants on the bare
--         pool by `token`, then 404s when nothing answers.
--   app/api/auth/invite-details/route.ts  the same read, so the page the invitee
--         lands on 404s before they can accept anything.
--
-- Measured on the local force-RLS dev database as an ordinary NOSUPERUSER
-- NOBYPASSRLS role (`nucrm_app`), one transaction, ROLLBACKed:
--
--   seeded an invitation under app.current_tenant, then cleared the GUC:
--     the route's read, no context           -> 0 rows        (the pool's answer)
--     the identical read with the tenant GUC -> 1 row         (the data is there)
--   UPDATE invitations SET accepted_at = now()   -> 0 rows affected, no error
--   INSERT INTO tenant_members …                 -> 42501 new row violates
--                                                    row-level security policy
--   INSERT INTO invitations … under app.is_super_admin = 'true' -> 42501 too:
--     the super-admin bypass reaches `users` and `tenants`, not this table, so
--     `app.current_tenant` is the only door — which is what makes this a
--     credential lookup and not a context the route could just supply.
--
-- `tenants ⋈` is unaffected: `tenants_read_all` is `USING true`, which is why the
-- join was never the failing half and why the 404 reads like "wrong token" rather
-- than "no privilege".
--
-- Granted the way 0105 granted the tracking read, 0088 the pre-auth login read,
-- 0122 the portal credential read and 0123 the rest of the bearer surface: SELECT
-- only, behind the SAME dedicated credential GUC (`app.portal_lookup_token`),
-- which nothing outside `withPortalLookupContext()` ever sets and which is
-- transaction-local inside it. Both pooled-reset lists
-- (lib/db/pool.ts:241, lib/db/request-connection.ts:94) already name that GUC, so
-- this migration adds no privilege name and neither list changes — the reason to
-- reuse it rather than mint `app.invite_lookup_token` is exactly that a new GUC is
-- a new thing that can leak across a PgBouncer checkout if anyone forgets it.
--
-- One arm, one table: `invitations.token` is UNIQUE (invitations_token_unique), so
-- the comparison matches at most one row, and `chk_invitations_token_length` bounds
-- it at 255 characters — inside `requireLookupValue()`'s 512-character cap, so an
-- over-long presentation is refused before it reaches the policy.
--
-- Deliberately NOT app.is_super_admin (#2253 measured one SET flipping 60 policies
-- across 49 tables from fail-closed to cross-tenant) and NOT app.current_tenant:
-- naming a workspace here would admit every invitation of that tenant — every
-- pending address and every role slug — to a caller who proved only one token.
--
-- FOR SELECT only, like 0123. Every write the acceptance flow performs
-- (`tenant_members` insert, `invitations.accepted_at`, `users.last_tenant_id`,
-- `tenants.current_users`, the member count) runs in `withTenantContext()` derived
-- from the row this read finds, and is policed by `tenant_isolation`'s WITH CHECK —
-- no write gains a new path here. Permissive policies OR, so with the GUC absent
-- this arm contributes nothing and the table stays exactly as closed as it is today.
--
-- `accepted_at IS NULL` / `expires_at > now()` stay in the QUERY, not the policy:
-- they are predicates of the route's decision, and 0122/0123 match on the credential
-- alone. A policy that quietly grew a second job would be invisible to whoever is
-- reading the WHERE clause.
--
-- Written as drop-then-create DO blocks (0100/0105/0122/0123's shape) rather than a
-- bare CREATE POLICY, so applying it by hand and having a later `db:migrate` replay
-- it are the same no-op instead of a duplicate-object abort.

DO $$
BEGIN
  DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations";
  CREATE POLICY "invitations_credential_lookup" ON "invitations"
    AS PERMISSIVE
    FOR SELECT
    USING (
      token = NULLIF(current_setting('app.portal_lookup_token', true), '')
    );
END $$;

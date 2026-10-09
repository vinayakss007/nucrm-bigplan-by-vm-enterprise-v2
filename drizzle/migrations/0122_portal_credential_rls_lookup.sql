/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0122: a read path for the customer portal's own credentials (#2446).
--
-- Every public portal route resolves WHO is calling before it can know which
-- tenant to scope the rest of the request to — and that resolution is itself a
-- read of a tenant-scoped table. `portal_clients`, `platform_settings` and
-- `support_tickets` each carry one `tenant_isolation` policy (FOR ALL) whose
-- USING clause compares `tenant_id` to `app.current_tenant`, a value the caller
-- cannot supply because finding it is the point of the query. Under the
-- fail-closed deparse those reads return nothing rather than raising, so:
--
--   POST /api/tenant/portal/login  reads platform_settings for the portal flag
--          -> no row -> {enabled:false} -> 403 "Portal not enabled", for a
--             portal that is enabled. No customer can log in.
--   resolvePortalIdentity()        reads portal_clients by access token
--          -> no row -> 401 for a valid token. The credential can never
--             authenticate, so every portal list, ticket and quote read 401s.
--   x-portal-ticket-token callers  read support_tickets by portal_token
--          -> no row -> 404 "Ticket not found" on a real ticket.
--
-- Granted the way 0105 granted the tracking read and 0088 granted the pre-auth
-- login read: SELECT only, behind its own GUC, which nothing outside
-- `withPortalLookupContext()` ever sets, and which is transaction-local inside
-- it (reset on every pooled checkout by lib/db/pool.ts and
-- lib/db/request-connection.ts).
--
-- It is deliberately NOT app.is_super_admin, and deliberately NOT
-- app.current_tenant:
--   - #2253 measured that one `SET app.is_super_admin='true'` flips 60 policies
--     across 49 tables from fail-closed to cross-tenant. Handing a public
--     endpoint the platform's widest context means the next bug in this route is
--     a fleet-wide read.
--   - `app.current_tenant` would work for login, whose body names a tenant, but
--     it admits EVERY row of that tenant — including the whole `access_token`
--     column of `portal_clients`, which is a bearer credential for the customer
--     portal. So the GUC names a *credential*, never a workspace, and each
--     policy below can match at most the rows that credential identifies.
--
-- Written as drop-then-create DO blocks (0100/0105's shape) rather than bare
-- CREATE POLICY, so applying it by hand and having a later `db:migrate` replay it
-- are the same no-op instead of a duplicate-object abort.

DO $$
BEGIN
  -- The portal client a credential names, and nothing else.
  --
  -- Two arms, because the portal presents two different credentials and each
  -- can only prove its own row:
  --   * `app.portal_lookup_token` holds a presented `access_token` (the
  --     `x-portal-token` header). Matching it against the column means the read
  --     can return the one row that token belongs to — a caller who guesses a
  --     token either gets that row or gets nothing, never a neighbour's.
  --   * `app.portal_lookup_tenant` + `app.portal_lookup_email` are the session
  --     cookie's own claims. The cookie cannot carry the token (it stores only
  --     SHA-256 of it, #1179), so this arm is keyed on the pair that identifies
  --     the row instead. Both must be set: the email alone would be a
  --     fleet-wide "find this address in any workspace" read, which is the
  --     spoofing class #1133/#1913 removed from the routes above the policy.
  --     Authentication stays where it was — the caller's token hash still has to
  --     match the row's access token (lib/portal-session.ts) — this only decides
  --     which row is visible to that comparison.
  DROP POLICY IF EXISTS "portal_clients_credential_lookup" ON "portal_clients";
  CREATE POLICY "portal_clients_credential_lookup" ON "portal_clients"
    AS PERMISSIVE
    FOR SELECT
    USING (
      (
        access_token = NULLIF(current_setting('app.portal_lookup_token', true), '')
      )
      OR (
        tenant_id = (NULLIF(current_setting('app.portal_lookup_tenant', true), ''))::uuid
        AND email = NULLIF(current_setting('app.portal_lookup_email', true), '')
      )
    );

  -- The portal on/off flag for one workspace, and nothing else on this table.
  --
  -- `platform_settings` is platform-wide configuration (one row per
  -- (tenant_id, key)); the portal only ever needs its own `portal_config` row,
  -- so the key is part of the policy rather than left to the query. An
  -- anonymous caller can already read these same three feature flags from
  -- GET /api/tenant/portal/login?tenant_id=, which is what that endpoint is for
  -- — but freezing the key keeps a future caller of this context from being
  -- handed billing flags, webhook secrets or SSO config by a policy it did not
  -- ask for.
  DROP POLICY IF EXISTS "platform_settings_portal_config_lookup" ON "platform_settings";
  CREATE POLICY "platform_settings_portal_config_lookup" ON "platform_settings"
    AS PERMISSIVE
    FOR SELECT
    USING (
      key = 'portal_config'
      AND tenant_id = (NULLIF(current_setting('app.portal_lookup_tenant', true), ''))::uuid
    );

  -- The ticket a per-ticket portal token names.
  --
  -- `support_tickets.portal_token` is the embed's whole credential: /tickets,
  -- /tickets/[id] and /tickets/[id]/replies all resolve it before they can know
  -- the tenant, and #2378 requires the lookup to be unscoped by tenant (and
  -- #2217/#2440 require the token never to be echoed). One token, one row.
  DROP POLICY IF EXISTS "support_tickets_portal_token_lookup" ON "support_tickets";
  CREATE POLICY "support_tickets_portal_token_lookup" ON "support_tickets"
    AS PERMISSIVE
    FOR SELECT
    USING (
      portal_token = NULLIF(current_setting('app.portal_lookup_token', true), '')
    );
END $$;

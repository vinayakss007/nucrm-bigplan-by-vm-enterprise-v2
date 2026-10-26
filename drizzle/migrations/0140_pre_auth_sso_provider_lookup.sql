/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0140: pre-auth lookups of the SSO provider a login handoff is about (#3246 step 3).
--
-- `/api/auth/sso` is in `proxy.ts:216`'s public list, so both its halves read
-- `sso_providers` before anyone is authenticated:
--
--   start/route.ts    resolves the provider that claims the caller's email DOMAIN
--   callback/route.ts resolves the provider named by the signed state COOKIE
--
-- `sso_providers` is `relrowsecurity = t` AND `relforcerowsecurity = t` with one
-- shipped arm, `tenant_isolation` — `tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`.
-- `sso_providers.tenant_id` is `NOT NULL`, so the first disjunct is never true, and
-- both reset lists pin the GUC to '' on every checkout, so the second is NULL. Each
-- lookup therefore matches zero rows: `start` answers 404 "No SSO provider is
-- configured for <domain>" for every tenant, and `callback` bounces the browser to
-- the login page with "SSO provider is no longer available" after a successful IdP
-- authentication. Same shape as #3237, #3245's plugin receiver (0139) and every
-- other arm in 0132–0139: verified input, unreachable endpoint.
--
-- Measured on the dev database as `nucrm_app` (temp FORCE-RLS tables shaped like
-- these two, in a rollback, 2026-10-26): with no GUC the row count is 0; with the
-- domain claim it is 1 for a claimed domain and 0 for a domain another provider
-- claims; with the id claim only that one row is visible; and with the claim cleared
-- it is 0 again.
--
-- Two arms, one per key, because the two halves hold different evidence:
--  * sso_providers_domain_lookup_read (SELECT) — keyed on `app.sso_lookup_domain`,
--    narrowed by VALUE the way 0136/0137/0138/0139 narrow, not by a boolean that
--    lets the query's own WHERE choose the row (0134's `app.auth_lookup = 'true'`
--    is that mistake). The predicate repeats the route's so a trashed or deactivated
--    provider is not readable by an anonymous caller: `provider_type = 'oidc'`,
--    `is_active`, `deleted_at IS NULL`, and `config->'email_domains' ?` the claim.
--    `jsonb ?` is strict, so an unset claim yields NULL and the arm stays closed.
--    The disclosure is what `start` already makes deliberately — it names the domain
--    in its own 404 — and the row it returns carries an encrypted client_secret.
--  * sso_providers_id_lookup_read (SELECT) — keyed on `app.sso_provider_id`, the id
--    from the state cookie. Deliberately does NOT repeat `is_active`: the route reads
--    that column to answer "no longer available" (callback/route.ts:70), so freezing
--    it here would move a decision the route already makes correctly (callback/route.ts:73).
--
-- WHAT STAYS UNDER THE EXISTING POLICY
-- -------------------------------------
-- `sso_sessions` gets nothing. The callback writes it after the IdP assertion, in the
-- same transaction that mints the `sessions` row, and `sso_sessions.tenant_isolation`
-- keys that insert on `app.current_tenant` — which the block was naming nothing,
-- because `withUserContext` sets only `app.current_user`. Measured: that insert raises
-- `new row violates row-level security policy` with the user named and the tenant at
-- '', and lands once the tenant is named too. The route's fix is to use the existing
-- `withTenantContext(tenantId, userId, …)`, which names both; no new arm is needed,
-- so none is granted. `sso_providers.tenant_isolation` is untouched by this migration.
--
-- Lands UNAPPLIED on production, like 0139 (PP-057's backlog, PP-060's missing apply
-- path). Written as a DO block, the way 0133–0139 are.

DO $$
BEGIN
  DROP POLICY IF EXISTS "sso_providers_domain_lookup_read" ON "sso_providers";
  CREATE POLICY "sso_providers_domain_lookup_read" ON "sso_providers"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "provider_type" = 'oidc'
      AND "is_active"
      AND "deleted_at" IS NULL
      AND ("config" -> 'email_domains') ? NULLIF(current_setting('app.sso_lookup_domain', true), '')
    );

  DROP POLICY IF EXISTS "sso_providers_id_lookup_read" ON "sso_providers";
  CREATE POLICY "sso_providers_id_lookup_read" ON "sso_providers"
    AS PERMISSIVE
    FOR SELECT
    USING (
      "id" = (NULLIF(current_setting('app.sso_provider_id', true), ''))::uuid
      AND "deleted_at" IS NULL
    );
END $$;

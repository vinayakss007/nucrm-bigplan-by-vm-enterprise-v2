-- ── api_keys: a pre-auth lookup read ─────────────────────────────────────
-- `api_keys` carries exactly one policy, `tenant_isolation`, whose USING clause
-- compares tenant_id to app.current_tenant. `tryApiKeyAuth` has to find the row
-- BEFORE it knows which tenant the key belongs to — that discovery is the whole
-- point of the read — so app.current_tenant is empty and the predicate matches
-- nothing. Every API key the settings page mints therefore authenticates as
-- "Invalid or expired token": the feature is dead on arrival, not misconfigured.
--
-- This is the same chicken-and-egg 0088 solved for `users` (users_auth_lookup),
-- and it is granted the same way: SELECT only, gated on app.auth_lookup, which
-- nothing outside withAuthLookupContext() ever sets, is transaction-local inside
-- that helper, and is reset on every pooled checkout (lib/db/pool.ts,
-- lib/db/request-connection.ts).
--
-- What the read can see is a row whose useful secret is `key_hash` — sha256 of
-- the presented key, not the key — so the exposure of widening SELECT to the
-- auth path is the same as the existing users lookup: identity, not credential.
CREATE POLICY "api_keys_auth_lookup" ON "api_keys" FOR SELECT USING (
  (current_setting('app.auth_lookup', true))::text = 'true'
);

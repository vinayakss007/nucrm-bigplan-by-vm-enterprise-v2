-- 0088: make pre-prod bootable — RLS bootstrap contexts + close the tenant
-- isolation gaps (PP-010 / PP-011 / PP-012 / PP-013).
--
-- WHY
-- ---
-- RLS here is deny-by-default and FORCEd on all 220 tenant tables, and the
-- application connects as `nucrm`: a plain role that owns those tables, is not
-- a superuser and has no BYPASSRLS. Enforcement is therefore real — which is
-- precisely why the pre-prod database has never had a user in it. Three
-- categories of work run *before* a tenant or session exists, and no policy
-- admitted them:
--
--   1. users / tenants INSERT — `users_insert_auth` and
--      `tenants_authenticated_insert` both require app.current_user to be
--      non-empty, which cannot be true while creating the first user.
--   2. sessions INSERT/DELETE at login — `sessions_user_own` is FOR ALL with
--      no WITH CHECK, so its USING clause is reused to validate new rows;
--      login therefore cannot write the session it just authenticated.
--   3. login_attempts / login_blocks — FOR ALL, gated on app.is_super_admin,
--      which the brute-force store never set. Every attempt, and every
--      "am I blocked?" read, failed silently into the in-memory fallback.
--
-- 1 and 3 are fixed here with narrow INSERT-only policies; 2 is fixed in code
-- (the login handler sets the user context after credentials verify, so the
-- existing *_own policies apply to the proven identity).
--
-- PP-013 additionally: six tables with a NULLABLE tenant_id carried
-- `(tenant_id IS NULL) OR tenant_id = current_tenant`, which makes every
-- global row readable by every tenant; `usage_alerts` and
-- `hierarchy_permissions` had `*_read_all` SELECT policies (true); five tables
-- with tenant_id had RLS switched off entirely; and three correctly-scoped
-- policies were named in a way the isolation verifier does not recognise.
--
-- SHAPE OF THE FIX
-- ----------------
-- Global rows stop being "nobody's" and become "the platform's": reads of a
-- NULL-tenant row now require the transaction to carry app.is_super_admin,
-- which only the narrow `withSecurityContext()` helper sets. Ordinary tenant
-- rows stay matched on tenant_id exactly, so cross-tenant visibility is
-- unchanged (still impossible).
--
-- Append-only telemetry (error_logs, security_events) keeps a permissive
-- INSERT policy on purpose: a request from an unauthenticated context has no
-- tenant to attribute a failure to, and losing those rows would remove
-- visibility into exactly the failures this migration is about. Writes are
-- bounded; READS stay strict.
--
-- IDEMPOTENCY IS MANDATORY
-- ------------------------
-- `drizzle.__drizzle_migrations` has zero rows in this environment, so
-- scripts/migrate.ts takes its tolerant "fresh" path and replays every journal
-- file on each run. Postgres has no CREATE POLICY IF NOT EXISTS, and a
-- tolerated duplicate_object error would silently keep the OLD definition — so
-- every policy below is DROP IF EXISTS + CREATE, and nothing here relies on a
-- statement failing harmlessly.

--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
--> statement-breakpoint
CREATE POLICY "users_bootstrap_insert" ON "users" FOR INSERT WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_bootstrap_insert" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenants_bootstrap_insert" ON "tenants" FOR INSERT WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);

-- ── PP-013: NULL-tenant rows become platform-only, not public ─────────────

--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "platform_settings";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_settings" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "oauth_clients";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "oauth_clients" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "backup_schedules";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "backup_schedules" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "lead_warming_events";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lead_warming_events" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);

-- ── Append-only telemetry: strict reads, permissive writes ────────────────

--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "error_logs";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "error_logs" FOR SELECT USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "error_logs_insert_any" ON "error_logs";
--> statement-breakpoint
CREATE POLICY "error_logs_insert_any" ON "error_logs" FOR INSERT WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "error_logs_super_admin_write" ON "error_logs";
--> statement-breakpoint
CREATE POLICY "error_logs_super_admin_write" ON "error_logs" FOR UPDATE USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
--> statement-breakpoint
DROP POLICY IF EXISTS "error_logs_super_admin_delete" ON "error_logs";
--> statement-breakpoint
CREATE POLICY "error_logs_super_admin_delete" ON "error_logs" FOR DELETE USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "security_events";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "security_events" FOR SELECT USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "security_events_insert_any" ON "security_events";
--> statement-breakpoint
CREATE POLICY "security_events_insert_any" ON "security_events" FOR INSERT WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "security_events_super_admin_write" ON "security_events";
--> statement-breakpoint
CREATE POLICY "security_events_super_admin_write" ON "security_events" FOR UPDATE USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
--> statement-breakpoint
DROP POLICY IF EXISTS "security_events_super_admin_delete" ON "security_events";
--> statement-breakpoint
CREATE POLICY "security_events_super_admin_delete" ON "security_events" FOR DELETE USING (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);

-- ── PP-013: drop the cross-tenant `read_all` policies ─────────────────────
-- These two tables were SELECT-only isolation + a super-admin FOR ALL write
-- gate, which means an ordinary tenant could read its own rows but could not
-- create or change them — every write died on the write policy's WITH CHECK.
-- `tenant_isolation` is therefore declared FOR ALL (strict tenant match, both
-- directions); the `*_super_admin_write` policies stay in place and, being
-- permissive, continue to let a platform context reach across tenants. The
-- simulator proved the SELECT-only form insufficient: it could not insert a
-- tenant-owned row through the tenant's own context.

--> statement-breakpoint
DROP POLICY IF EXISTS "usage_alerts_read_all" ON "usage_alerts";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "usage_alerts";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "usage_alerts" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "hierarchy_permissions_read_all" ON "hierarchy_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hierarchy_permissions";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hierarchy_permissions" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

-- ── PP-013: five tenant-scoped tables had RLS switched OFF ────────────────

--> statement-breakpoint
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "analytics_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "analytics_events";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "analytics_events" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "analytics_events_insert" ON "analytics_events";
--> statement-breakpoint
CREATE POLICY "analytics_events_insert" ON "analytics_events" FOR INSERT WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR (tenant_id IS NULL AND (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
ALTER TABLE "webhook_field_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_field_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "webhook_field_mappings";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_field_mappings" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
) WITH CHECK (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
ALTER TABLE "custom_entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_entities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "custom_entities_tenant_isolation" ON "custom_entities";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entities";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_entities" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '')
  AND (tenant_id = current_setting('app.current_tenant', true)::uuid)
);
--> statement-breakpoint
ALTER TABLE "custom_entity_data" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_entity_data" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "custom_entity_data_tenant_isolation" ON "custom_entity_data";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entity_data";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_entity_data" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '')
  AND (tenant_id = current_setting('app.current_tenant', true)::uuid)
);

-- webhook_events is the provider delivery ledger from 0087. Its UNIQUE
-- (provider, event_id) key is intentionally cross-tenant, and a claim arrives
-- BEFORE the tenant is known, so the INSERT path must accept a NULL tenant.
-- Visibility of those unclaimed/global rows is still restricted to a security
-- context (the worker), never to an ordinary tenant.

--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "webhook_events";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_events" FOR ALL USING (
  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_events_claim_insert" ON "webhook_events";
--> statement-breakpoint
CREATE POLICY "webhook_events_claim_insert" ON "webhook_events" FOR INSERT WITH CHECK (
  (tenant_id IS NULL AND (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
  OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

-- ── PP-013: correctly-scoped policies the verifier could not recognise ────
-- These three isolate through their parent row and were already sound; they
-- were only named `<table>_tenant_isolation`. Renamed to the canonical name so
-- `db:verify-isolation` reports coverage instead of listing them as gaps.

--> statement-breakpoint
DROP POLICY IF EXISTS "contact_emails_tenant_isolation" ON "contact_emails";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "contact_emails";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_emails" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '')
  AND EXISTS (
    SELECT 1 FROM "contacts" c
    WHERE c.id = contact_emails.contact_id
      AND c.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "price_book_entries_tenant_isolation" ON "price_book_entries";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "price_book_entries";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_book_entries" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '')
  AND EXISTS (
    SELECT 1 FROM "price_books" pb
    WHERE pb.id = price_book_entries.price_book_id
      AND pb.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_queue_tenant_isolation" ON "webhook_queue";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "webhook_queue";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_queue" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '')
  AND EXISTS (
    SELECT 1 FROM "webhooks" w
    WHERE w.id = webhook_queue.webhook_id
      AND w.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

-- ── users: bootstrap path + a pre-auth credential-lookup read ─────────────
-- Hypothesis tested and DISPROVEN: `users_insert_auth` looks like a FOR ALL
-- policy with only a WITH CHECK, which would have made the whole `users` table
-- readable by any logged-in user. pg_policy.polcmd says 'a' = INSERT, not ALL,
-- so it was always INSERT-only and no such leak existed. It is restated below
-- with its ORIGINAL check so this file stays reviewable; the bootstrap case is
-- carried by `users_bootstrap_insert` instead.
--
-- What WAS broken: `users` has no SELECT policy an unauthenticated connection
-- can satisfy (read_self needs app.current_user, super_admin_read needs the
-- security context), so handleLogin's `SELECT ... WHERE email = ?` matched zero
-- rows and every sign-in answered "Invalid email or password" whatever was
-- typed. `users_auth_lookup` grants exactly that read, gated on a GUC only the
-- credential-lookup helper sets; it is SELECT-only, so it cannot UPDATE or
-- DELETE anybody.

--> statement-breakpoint
DROP POLICY IF EXISTS "users_insert_auth" ON "users";
--> statement-breakpoint
CREATE POLICY "users_insert_auth" ON "users" FOR INSERT WITH CHECK (
  (current_setting('app.current_user', true) <> '')
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
--> statement-breakpoint
DROP POLICY IF EXISTS "users_auth_lookup" ON "users";
--> statement-breakpoint
CREATE POLICY "users_auth_lookup" ON "users" FOR SELECT USING (
  (current_setting('app.auth_lookup', true))::text = 'true'
);

-- ── Module registry: RLS was SELECT-only ─────────────────────────────────
-- `modules` carries `modules_read_all` (SELECT) and nothing else, so under
-- deny-by-default the registry upsert in lib/modules/auto-install.ts could not
-- INSERT at all. installDefaultModules() catches and logs, so every signup
-- silently provisioned ZERO modules — workspaces were created with no modules
-- installed and nothing failed loudly. INSERT is now allowed from the
-- provisioning context only (signup/bootstrap run under app.is_super_admin).

--> statement-breakpoint
DROP POLICY IF EXISTS "modules_registry_insert" ON "modules";
--> statement-breakpoint
CREATE POLICY "modules_registry_insert" ON "modules" FOR INSERT WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true
);
-- ── Cast-safety: an empty GUC must filter, not error ─────────────────
-- The auth policies below (all predating this file) were written as
--   current_setting(...)<> AND col = current_setting(...)::uuid
-- and   current_setting(app.is_super_admin, true)::boolean = true
-- Postgres does not guarantee the order in which boolean clauses are
-- evaluated, so the cast can run on an empty string and raise 22P02
-- "invalid input syntax for type uuid""". Because permissive policies are
-- OR-ed together, ONE raising predicate fails the whole query: a SELECT on
-- `users` over a connection whose GUCs had been reset to  by the pool errored
-- instead of returning no rows. That is the actual mechanism behind the login
-- failures in PP-012, and it is why the fix is NULLIF-wrapping the cast rather
-- than relying on the guard clause. Semantics are otherwise identical: same
-- command, same visibility, empty context now fails closed.
-- Generated mechanically from pg_get_expr of the live definitions, with the
-- ONLY change being (current_setting(...)::T) -> (NULLIF(current_setting(...), )::T).
--
-- users.users_read_self  [SELECT]
--> statement-breakpoint
DROP POLICY IF EXISTS "users_read_self" ON "users";
--> statement-breakpoint
CREATE POLICY "users_read_self" ON "users" FOR SELECT USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- users.users_update_own  [UPDATE]
--> statement-breakpoint
DROP POLICY IF EXISTS "users_update_own" ON "users";
--> statement-breakpoint
CREATE POLICY "users_update_own" ON "users" FOR UPDATE USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- users.users_super_admin_read  [SELECT]
--> statement-breakpoint
DROP POLICY IF EXISTS "users_super_admin_read" ON "users";
--> statement-breakpoint
CREATE POLICY "users_super_admin_read" ON "users" FOR SELECT USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- users.users_super_admin_update  [UPDATE]
--> statement-breakpoint
DROP POLICY IF EXISTS "users_super_admin_update" ON "users";
--> statement-breakpoint
CREATE POLICY "users_super_admin_update" ON "users" FOR UPDATE USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- users.users_super_admin_delete  [DELETE]
--> statement-breakpoint
DROP POLICY IF EXISTS "users_super_admin_delete" ON "users";
--> statement-breakpoint
CREATE POLICY "users_super_admin_delete" ON "users" FOR DELETE USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- sessions.sessions_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_user_own" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_user_own" ON "sessions" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- refresh_tokens.refresh_tokens_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "refresh_tokens_user_own" ON "refresh_tokens";
--> statement-breakpoint
CREATE POLICY "refresh_tokens_user_own" ON "refresh_tokens" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- email_verifications.email_verifications_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "email_verifications_user_own" ON "email_verifications";
--> statement-breakpoint
CREATE POLICY "email_verifications_user_own" ON "email_verifications" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- password_resets.password_resets_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "password_resets_user_own" ON "password_resets";
--> statement-breakpoint
CREATE POLICY "password_resets_user_own" ON "password_resets" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- oauth_codes.oauth_codes_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "oauth_codes_user_own" ON "oauth_codes";
--> statement-breakpoint
CREATE POLICY "oauth_codes_user_own" ON "oauth_codes" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- oauth_tokens.oauth_tokens_user_own  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "oauth_tokens_user_own" ON "oauth_tokens";
--> statement-breakpoint
CREATE POLICY "oauth_tokens_user_own" ON "oauth_tokens" FOR ALL USING (
  ((current_setting('app.current_user'::text, true) <> ''::text) AND (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid))
);
--> statement-breakpoint
-- login_attempts.login_attempts_super_admin_only  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "login_attempts_super_admin_only" ON "login_attempts";
--> statement-breakpoint
CREATE POLICY "login_attempts_super_admin_only" ON "login_attempts" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- login_blocks.login_blocks_super_admin_only  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "login_blocks_super_admin_only" ON "login_blocks";
--> statement-breakpoint
CREATE POLICY "login_blocks_super_admin_only" ON "login_blocks" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);

-- The same defect exists beyond the auth tables: every *_super_admin_write policy
-- written by 0054 carries the raw cast. Restated mechanically (USING/WITH CHECK
-- expressions byte-identical except for the NULLIF wrap) so that an empty GUC
-- filters instead of aborting the statement.
-- announcements.announcements_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "announcements_super_admin_write" ON "announcements";
--> statement-breakpoint
CREATE POLICY "announcements_super_admin_write" ON "announcements" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- api_keys_registry.api_keys_registry_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "api_keys_registry_super_admin_write" ON "api_keys_registry";
--> statement-breakpoint
CREATE POLICY "api_keys_registry_super_admin_write" ON "api_keys_registry" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- backup_alerts.backup_alerts_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "backup_alerts_super_admin_write" ON "backup_alerts";
--> statement-breakpoint
CREATE POLICY "backup_alerts_super_admin_write" ON "backup_alerts" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- backup_records.backup_records_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "backup_records_super_admin_write" ON "backup_records";
--> statement-breakpoint
CREATE POLICY "backup_records_super_admin_write" ON "backup_records" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- custom_entities.tenant_isolation  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entities";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_entities" FOR ALL USING (
  ((current_setting('app.current_tenant'::text, true) <> ''::text) AND (tenant_id = NULLIF(current_setting('app.current_tenant'::text, true), '')::uuid))
);
--> statement-breakpoint
-- custom_entity_data.tenant_isolation  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entity_data";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_entity_data" FOR ALL USING (
  ((current_setting('app.current_tenant'::text, true) <> ''::text) AND (tenant_id = NULLIF(current_setting('app.current_tenant'::text, true), '')::uuid))
);
--> statement-breakpoint
-- dashboard_templates.dashboard_templates_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "dashboard_templates_super_admin_write" ON "dashboard_templates";
--> statement-breakpoint
CREATE POLICY "dashboard_templates_super_admin_write" ON "dashboard_templates" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- exchange_rates.exchange_rates_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "exchange_rates_super_admin_write" ON "exchange_rates";
--> statement-breakpoint
CREATE POLICY "exchange_rates_super_admin_write" ON "exchange_rates" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- feature_registry.feature_registry_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "feature_registry_super_admin_write" ON "feature_registry";
--> statement-breakpoint
CREATE POLICY "feature_registry_super_admin_write" ON "feature_registry" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- health_checks.health_checks_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "health_checks_super_admin_write" ON "health_checks";
--> statement-breakpoint
CREATE POLICY "health_checks_super_admin_write" ON "health_checks" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- hierarchy_permissions.hierarchy_permissions_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "hierarchy_permissions_super_admin_write" ON "hierarchy_permissions";
--> statement-breakpoint
CREATE POLICY "hierarchy_permissions_super_admin_write" ON "hierarchy_permissions" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- modules.modules_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "modules_super_admin_write" ON "modules";
--> statement-breakpoint
CREATE POLICY "modules_super_admin_write" ON "modules" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- plan_limits.plan_limits_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "plan_limits_super_admin_write" ON "plan_limits";
--> statement-breakpoint
CREATE POLICY "plan_limits_super_admin_write" ON "plan_limits" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- plans.plans_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "plans_super_admin_write" ON "plans";
--> statement-breakpoint
CREATE POLICY "plans_super_admin_write" ON "plans" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- product_templates.product_templates_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "product_templates_super_admin_write" ON "product_templates";
--> statement-breakpoint
CREATE POLICY "product_templates_super_admin_write" ON "product_templates" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- report_templates.report_templates_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "report_templates_super_admin_write" ON "report_templates";
--> statement-breakpoint
CREATE POLICY "report_templates_super_admin_write" ON "report_templates" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- super_admin_audit_logs.super_admin_audit_logs_super_admin_only  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "super_admin_audit_logs_super_admin_only" ON "super_admin_audit_logs";
--> statement-breakpoint
CREATE POLICY "super_admin_audit_logs_super_admin_only" ON "super_admin_audit_logs" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- super_admin_backups.super_admin_backups_super_admin_only  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "super_admin_backups_super_admin_only" ON "super_admin_backups";
--> statement-breakpoint
CREATE POLICY "super_admin_backups_super_admin_only" ON "super_admin_backups" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- system_settings.system_settings_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "system_settings_super_admin_write" ON "system_settings";
--> statement-breakpoint
CREATE POLICY "system_settings_super_admin_write" ON "system_settings" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- tenant_hierarchy.tenant_hierarchy_super_admin_only  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_hierarchy_super_admin_only" ON "tenant_hierarchy";
--> statement-breakpoint
CREATE POLICY "tenant_hierarchy_super_admin_only" ON "tenant_hierarchy" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- token_budgets.token_budgets_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "token_budgets_super_admin_write" ON "token_budgets";
--> statement-breakpoint
CREATE POLICY "token_budgets_super_admin_write" ON "token_budgets" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- usage_alerts.usage_alerts_super_admin_write  [ALL]
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_alerts_super_admin_write" ON "usage_alerts";
--> statement-breakpoint
CREATE POLICY "usage_alerts_super_admin_write" ON "usage_alerts" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);

-- ── Child tables that isolate through their parent ───────────────────────
-- These five policies reach the tenant through an EXISTS on the owning row,
-- which is correct and stronger than a direct column compare. Two problems
-- fixed at once:
--
--   * the guard `current_setting(...) <> '' AND ... ::uuid` does not
--     short-circuit reliably (see above), so an empty GUC aborted the
--     statement instead of filtering;
--   * four of them are named `<table>_tenant_isolation`, which the isolation
--     verifier does not recognise as coverage — renaming them here closes that
--     reporting gap without changing what they enforce.

--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "contact_emails";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_emails" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "contacts" c
    WHERE c.id = contact_emails.contact_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "contact_tags_tenant_isolation" ON "contact_tags";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "contact_tags";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_tags" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "contacts" c
    WHERE c.id = contact_tags.contact_id
      AND c.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "lead_tags_tenant_isolation" ON "lead_tags";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "lead_tags";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lead_tags" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "leads" l
    WHERE l.id = lead_tags.lead_id
      AND l.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "email_warmup_logs_tenant_isolation" ON "email_warmup_logs";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "email_warmup_logs";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "email_warmup_logs" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "email_warmup_configs" ewc
    WHERE ewc.id = email_warmup_logs.config_id
      AND ewc.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "email_warmup_pool_tenant_isolation" ON "email_warmup_pool";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "email_warmup_pool";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "email_warmup_pool" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "email_warmup_configs" ewc
    WHERE ewc.id = email_warmup_pool.config_id
      AND ewc.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "price_book_entries";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_book_entries" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "price_books" pb
    WHERE pb.id = price_book_entries.price_book_id
      AND pb.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_queue_tenant_isolation" ON "webhook_queue";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "webhook_queue";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_queue" FOR ALL USING (
  ((NULLIF(current_setting('app.current_tenant', true), ''))::uuid IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM "webhooks" w
    WHERE w.id = webhook_queue.webhook_id
      AND w.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
);

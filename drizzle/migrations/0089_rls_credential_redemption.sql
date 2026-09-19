-- ─────────────────────────────────────────────────────────────────────────
-- PP-026 — pre-auth CREDENTIAL REDEMPTION (found by the live API E2E run)
-- ─────────────────────────────────────────────────────────────────────────
-- 0088 made the pre-auth *writes* possible. The live run then showed the
-- mirror-image defect: a session minted at login could never be *redeemed*,
-- because turning a presented cookie back into an identity is a pre-auth READ
-- and the only policy on these tables was `*_user_own`, which keys off
-- app.current_user — a value that can only exist *after* the read succeeds.
-- Chicken and egg: every request carrying a valid session answered 401
-- "Session expired", so the app stayed unusable even though
-- /api/setup/create-admin and /api/auth/signup returned 2xx.
--
-- This is a SEPARATE migration rather than an append to 0088 on purpose:
-- 0088 is already journalled, and scripts/migrate.ts decides what is
-- outstanding by comparing each entry's folderMillis against the newest
-- `created_at` in drizzle.__drizzle_migrations — NOT by hash. Appending to an
-- applied migration would therefore never execute on any environment that
-- already ran 0088. A new tag always runs.
--
-- Fix: one narrow, read-mostly context for credential redemption, reusing the
-- existing app.auth_lookup GUC (already admitted to users.users_auth_lookup).
-- Grant shape per table:
--   sessions             SELECT by app.auth_lookup; FOR ALL by security ctx
--   password_resets      INSERT/SELECT by app.auth_lookup; FOR ALL by security
--   email_verifications  INSERT/SELECT by app.auth_lookup; FOR ALL by security
-- app.auth_lookup is set only inside withAuthLookupContext(), whose callbacks
-- are a single keyed lookup, and it never admits UPDATE or DELETE.
--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_auth_lookup" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_auth_lookup" ON "sessions" FOR SELECT USING (
  (current_setting('app.auth_lookup'::text, true) = 'true'::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_security" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_security" ON "sessions" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
) WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "password_resets_auth_insert" ON "password_resets";
--> statement-breakpoint
CREATE POLICY "password_resets_auth_insert" ON "password_resets" FOR INSERT WITH CHECK (
  (current_setting('app.auth_lookup'::text, true) = 'true'::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "password_resets_auth_select" ON "password_resets";
--> statement-breakpoint
CREATE POLICY "password_resets_auth_select" ON "password_resets" FOR SELECT USING (
  (current_setting('app.auth_lookup'::text, true) = 'true'::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "password_resets_security" ON "password_resets";
--> statement-breakpoint
CREATE POLICY "password_resets_security" ON "password_resets" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
) WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "email_verifications_auth_insert" ON "email_verifications";
--> statement-breakpoint
CREATE POLICY "email_verifications_auth_insert" ON "email_verifications" FOR INSERT WITH CHECK (
  (current_setting('app.auth_lookup'::text, true) = 'true'::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "email_verifications_auth_select" ON "email_verifications";
--> statement-breakpoint
CREATE POLICY "email_verifications_auth_select" ON "email_verifications" FOR SELECT USING (
  (current_setting('app.auth_lookup'::text, true) = 'true'::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "email_verifications_security" ON "email_verifications";
--> statement-breakpoint
CREATE POLICY "email_verifications_security" ON "email_verifications" FOR ALL USING (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
) WITH CHECK (
  (NULLIF(current_setting('app.is_super_admin'::text, true), '')::boolean = true)
);
--> statement-breakpoint
-- The redemption read does not stop at `sessions`: requireAuth then loads the
-- user row and, for non-super-admins, the tenant_members + roles rows that
-- build the AuthContext. Those two tables only carried `tenant_isolation`,
-- which needs app.current_tenant — a value the membership read is supposed to
-- *discover*. Same chicken-and-egg, so a valid cookie would still have ended in
-- "no workspace". Both additions are self-scoped: you may read your own
-- memberships, and only the roles of tenants you are a member of.
--
-- Both run under withAuthResolutionContext(userId): app.current_user comes from
-- a cryptographically verified session token, never from client input.
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_members_user_own" ON "tenant_members";
--> statement-breakpoint
CREATE POLICY "tenant_members_user_own" ON "tenant_members" FOR SELECT USING (
  (user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid)
);
--> statement-breakpoint
DROP POLICY IF EXISTS "roles_member_read" ON "roles";
--> statement-breakpoint
CREATE POLICY "roles_member_read" ON "roles" FOR SELECT USING (
  (tenant_id IS NULL)
  OR EXISTS (
    SELECT 1 FROM "tenant_members" tm
    WHERE tm.tenant_id = roles.tenant_id
      AND tm.user_id = NULLIF(current_setting('app.current_user'::text, true), '')::uuid
  )
);

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #3302 — FORCE the one table the chain enabled after 0068's loop had already run.
--
-- Measured on a database built from the shipped journal, not read off the SQL text:
--
--   select count(*) filter (where relrowsecurity)                        as rls_on,
--          count(*) filter (where relrowsecurity and relforcerowsecurity) as forced,
--          count(*)                                                       as total
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r';
--     rls_on | forced | total
--      226    | 225    | 226
--
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and c.relrowsecurity and not c.relforcerowsecurity;
--     ai_providers
--
-- One table out of 226, and it is not an accident of a half-applied deploy.
-- `0068_force_rls_owner.sql` does not name tables: it loops over
-- `pg_class where relrowsecurity` and FORCEs everything it finds at that moment.
-- `0115_rls_view_hardening.sql` runs 47 files LATER and does
-- `ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY` plus two policies, with no
-- FORCE — so 0068 never saw this table, and no later file named it either. Every
-- table that predates 0068 is covered without ever being listed; that is exactly
-- why the coverage is invisible to a grep over the migrations and why the rule had
-- to become temporal (`findForceRlsGaps` in `scripts/check-migration-rls-dml.mjs`).
--
-- WHY NOTHING DETECTED IT
-- -----------------------
-- Both screens that look for this class of hole select tables by "has a uuid
-- `tenant_id` column", a criterion `ai_providers` does not meet:
--   - `scripts/check-migration-rls-dml.mjs:262-287` builds its tenant-scoped set as
--     policy-derived ∪ column-declared, and its own comment admits the column branch
--     "would miss policy-bearing tables with no tenant_id column";
--   - `lib/db/least-privilege.ts`'s `TENANT_TABLE_OWNERSHIP_SQL` and
--     `scripts/preflight.ts`'s `db:rls` step both `JOIN pg_attribute … attname =
--     'tenant_id' JOIN pg_type … typname = 'uuid'`.
-- So `ai_providers` is not inside those counts reporting the wrong thing about it; it
-- is outside the denominator, and a 225-of-226 schema prints as a perfect score.
--
-- WHAT FORCE IS WORTH HERE, STATED HONESTLY
-- -----------------------------------------
-- `relforcerowsecurity` exempts the table OWNER from its own policies. This table is
-- owned by `nucrm`, and `nucrm` is `rolsuper = t` and `rolbypassrls = t`, and a
-- superuser ignores FORCE as well. So on today's topology this ALTER changes nothing
-- observable, and it is not claimed to. What it buys is the topology the repo is
-- deliberately walking toward: `scripts/check-db-role-privileges.mjs` exists to move
-- the connecting role off a superuser, and `0068`'s own issue (#1218) is the previous
-- time that exemption was worth a migration. The day ownership lands on a
-- non-privileged role — or the day someone adds a second catalogue table the same way
-- 0115 added this one — an owner-role connection reads and writes `ai_providers` with
-- no policy applied and every guard still reports green. `ai_providers_super_admin_write`
-- is the policy that would stop being decorative.
--
-- The `FORCE` is safe against the seed path, which is the only writer:
-- `scripts/seed-dev.ts` inserts provider rows under `app.is_super_admin`, and
-- `ai_providers_super_admin_write` grants `ALL` on exactly that GUC, so the write
-- keeps its privilege. `ai_providers_read_all` is `USING (true)`, so no read changes
-- either. Nothing in `app/` or `lib/` touches this table at runtime — the per-tenant
-- AI key/config surface is `tenants.settings->'ai_providers'` jsonb plus the encrypted
-- key table (see the `drizzle/schema/ai.ts` header), which 0115's own comment says —
-- so there is no request path to regress. `select count(*) from ai_providers` is 0 on
-- a fresh deploy.
--
-- Reversal: `0141_ai_providers_force_rls.down.sql`. The companion rule that keeps
-- this from happening again is `npm run guard:migration-rls`, which now fails on any
-- table the chain enables without forcing and prints the census as a number over the
-- whole population instead of over the tenant-scoped subset.

BEGIN;

--> statement-breakpoint
ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  still_unforced integer;
BEGIN
  SELECT count(*) INTO still_unforced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
     AND NOT c.relforcerowsecurity;

  -- Self-checking rather than decorative: this raises 0 rows only if the ALTER above
  -- took effect AND no other table is in the same state, which is the whole property
  -- #3302 is about. A future migration that repeats 0115's mistake surfaces here at
  -- deploy time, in the database, before the CI census has a chance to be skipped.
  IF still_unforced > 0 THEN
    RAISE WARNING '#3302: % table(s) still ENABLE RLS without FORCE after this migration: %',
      still_unforced,
      (SELECT string_agg(c.relname, ', ' order by c.relname)
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relrowsecurity AND NOT c.relforcerowsecurity);
  ELSE
    RAISE NOTICE '#3302: ai_providers forced; every RLS-enabled table in public is now FORCE ROW LEVEL SECURITY.';
  END IF;
END
$$;

COMMIT;

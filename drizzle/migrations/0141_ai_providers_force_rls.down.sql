-- #3302 rollback: put `ai_providers` back to plain ENABLE ROW LEVEL SECURITY.
--
-- One statement, and it is the exact inverse: 0141 touched no policy, no grant, no
-- row and no other table, so there is nothing here to re-attach. Postgres keeps
-- `relrowsecurity` set; `NO FORCE` only clears the owner exemption, which is the
-- state the table was in between 0115 and 0141.
--
-- Rolling this back re-opens the hole rather than stranding anything. No application
-- path reads or writes `ai_providers` (0115's header and `drizzle/schema/ai.ts` both
-- say the live surface is `tenants.settings->'ai_providers'` jsonb), the table has 0
-- rows on a fresh deploy, and the only writer in the repository is
-- `scripts/seed-dev.ts`, which sets `app.is_super_admin` and so keeps its privilege
-- either way. Nothing stored changes, so nothing needs repairing.
--
-- Running this is also how the #3302 census is demonstrated to bite without waiting
-- for a database that still has the hole: apply the down, and
-- `npm run guard:migration-rls` reports `ai_providers (enabled by
-- 0115_rls_view_hardening.sql)` again — because the census reads the chain, not the
-- live catalog, that only happens if 0141 is removed, which is why the integration
-- spec asserts the property inside a transaction against NO FORCE instead.

BEGIN;

--> statement-breakpoint
ALTER TABLE "ai_providers" NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  unforced integer;
BEGIN
  SELECT count(*) INTO unforced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
     AND NOT c.relforcerowsecurity;

  RAISE NOTICE '#3302 rolled back: % table(s) in public now ENABLE RLS without FORCE. Expected 1 (ai_providers) until 0141 is re-applied.',
    unforced;
END
$$;

COMMIT;

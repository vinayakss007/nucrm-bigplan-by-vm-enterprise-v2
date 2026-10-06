/*! NuCRM Enterprise — Issue #2259 (second half): one enum CHECK per column (3) */
--
-- 1. Rationale. 0113_dedupe_foreign_keys.sql collapsed the duplicate foreign
--    keys this issue reported; the same restatement pattern survived in CHECK
--    constraints. PostgreSQL enforces EVERY check on a column, so two identical
--    value-list checks validate the same rule twice per write, and — the part
--    that actually bites — the two definitions can silently diverge, at which
--    point the stricter one wins and a value the app legitimately writes starts
--    throwing 23514 out of a constraint nobody is reading. The issue's own
--    example is one of the three groups below.
--
-- 2. Detection. Not guessed: pg_constraint (contype='c', cardinality(conkey)=1)
--    grouped by (table, column) over the `CHECK (col = ANY (ARRAY[…]))` shape,
--    on a fresh replay of 0001..0118 at head. Exactly three groups:
--      tasks.priority       chk_tasks_priority        (0050)
--                           chk_tasks_priority_valid  (0045)  identical list
--      tasks.status         chk_tasks_status          (0050)
--                           chk_tasks_status_valid    (0045)  same 6 values,
--                                                             array order only
--      team_members.role    chk_team_members_role     (0050)
--                           team_members_role_valid   (0041)  identical list
--    Every other same-column CHECK pair enforces a different rule (the
--    chk_*_length limits from 0056, not-null restatements) and is kept.
--
-- 3. Keep/drop rule. Keep the FIRST declaration of the vocabulary (0045/0041);
--    0050_data_validation_checks restated it. Normalise the survivor name to
--    `chk_<table>_<column>_valid`, the convention drizzle/schema uses for its
--    own checks (record_links_*_valid). Only team_members needs the rename — its
--    survivor predates the `chk_` prefix and is metadata-only (no scan). Because
--    each group's value SET is identical, no write that succeeded before can
--    fail after and none can newly pass: this is a pure metadata change.
--
-- 4. Idempotent and rerunnable — live deploys lag migrations (#2299, #2233), so
--    a half-applied state is normal: every DROP is IF EXISTS and the RENAME is
--    guarded by EXISTS(old) AND NOT EXISTS(new).
--
-- 5. Scope note. These three CHECKs exist only as migration DDL: drizzle/schema
--    declares no check for tasks.status / tasks.priority / team_members.role
--    (role is text({enum:[…]}), which drizzle-pg does not compile to a CHECK), so
--    `drizzle-kit generate` can neither restate nor drop them and the duplicate
--    was purely two hand-written migrations. scripts/constraint-vocab.json tracks
--    none of these six names, so `npm run guard:vocab` is unaffected. The
--    regression guard is tests/unit/dup-check-drop-2259.test.ts.

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "chk_tasks_status";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "chk_tasks_priority";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "chk_team_members_role";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'team_members_role_valid')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'chk_team_members_role_valid')
  THEN
    ALTER TABLE team_members RENAME CONSTRAINT team_members_role_valid TO chk_team_members_role_valid;
  END IF;
END $$;

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2259 second half (down): restore the duplicate-CHECK landscape
-- 0119_dedupe_check_constraints.sql collapsed — reverse the rename, then re-add
-- the three dropped checks with the exact definitions (and value order) the
-- source migrations used, so a reverted host matches a fresh replay of
-- 0001..0118 byte-for-byte in pg_get_constraintdef terms.
--
-- Reverting re-grows the double validation this change removes, and leaves two
-- constraints that can drift apart again — which is the defect #2259 reported.
-- Run only with the matching up-file removal from the journal.
--
-- Each ADD is guarded by NOT EXISTS so the file is rerunnable on a host where
-- only part of it landed; existing rows already satisfy every check (the
-- surviving twin enforces the same value set), so no ADD ever has to validate a
-- failing row.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'chk_team_members_role_valid')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'team_members_role_valid')
  THEN
    ALTER TABLE team_members RENAME CONSTRAINT chk_team_members_role_valid TO team_members_role_valid;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'chk_tasks_status') THEN
    ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('pending','in_progress','completed','cancelled','deferred','on_hold'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'chk_tasks_priority') THEN
    ALTER TABLE tasks ADD CONSTRAINT chk_tasks_priority
      CHECK (priority IN ('low','medium','high','urgent'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'chk_team_members_role') THEN
    ALTER TABLE team_members ADD CONSTRAINT chk_team_members_role
      CHECK (role IN ('manager','member'));
  END IF;
END $$;

-- 0078: drop the two dead backup/restore tables (issues #1337 / #1378).
--
-- `tenant_backups` and `tenant_restores` had ZERO references in app/ or lib/
-- (no ORM usage, no raw SQL) — pure dead code that contributed to the
-- "3 backup tables" confusion. The canonical backup catalog is `backup_records`
-- (written by lib/backups/backup-service.ts); `tenant_backup_records` and
-- `super_admin_backups` remain (distinct, actively-used purposes).
--
-- Drop order matters: tenant_restores holds a FK to tenant_backups, so it goes
-- first. Guarded with IF EXISTS so this is a no-op on databases where a prior
-- cleanup (or db:push) already removed them. CASCADE covers the self-FK.

DROP TABLE IF EXISTS "tenant_restores" CASCADE;
DROP TABLE IF EXISTS "tenant_backups" CASCADE;

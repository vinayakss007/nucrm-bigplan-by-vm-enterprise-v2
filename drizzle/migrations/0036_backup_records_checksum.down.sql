-- Rollback 0036_backup_records_checksum (#3284)
-- The down half of this migration always existed — inline, after `-- DOWN`, in
-- 0036_backup_records_checksum.sql. `lib/db/rollback.ts` prefers a sibling `.down.sql` and
-- counts a migration without one as not automatically revertable, so `db:rollback:coverage`
-- reported 138/139 and `db:rollback 0036_backup_records_checksum` refused to run. The same
-- two statements, in the file the runner looks for; the inline section is left untouched.

BEGIN;

ALTER TABLE backup_records DROP COLUMN IF EXISTS checksum_algorithm;
ALTER TABLE backup_records DROP COLUMN IF EXISTS checksum;

COMMIT;

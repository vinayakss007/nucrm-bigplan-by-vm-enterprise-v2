-- Rollback 0003_fix_duplicate_tables
-- This migration removed duplicate tables. Rolling back would recreate them,
-- but since the originals had the data, a no-op rollback is safest.
-- The duplicates were empty tables created by a bug.
SELECT 1; -- no-op rollback (duplicates were empty)

-- Migration ID: 0042_backup_records_checksum
-- Name: Record a content digest for every backup artefact
-- Dependencies: 0041_add_form_views_count

-- A backup that cannot be proven byte-identical to what was written is an
-- assumption, not a backup. Storing the digest alongside the record lets a
-- restore verify the artefact it fetched and makes silent storage corruption
-- or truncation detectable before the data is relied on.
--
-- Existing rows keep checksum = NULL, which verification treats as
-- "unverifiable" rather than "valid".

-- UP Migration
BEGIN;

ALTER TABLE backup_records ADD COLUMN IF NOT EXISTS checksum TEXT;
ALTER TABLE backup_records ADD COLUMN IF NOT EXISTS checksum_algorithm TEXT DEFAULT 'sha256';

COMMIT;

-- DOWN Migration
-- DOWN
BEGIN;

ALTER TABLE backup_records DROP COLUMN IF EXISTS checksum;
ALTER TABLE backup_records DROP COLUMN IF EXISTS checksum_algorithm;

COMMIT;
-- END DOWN

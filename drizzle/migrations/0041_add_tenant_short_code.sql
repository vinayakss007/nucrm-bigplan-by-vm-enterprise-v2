-- Migration ID: 0041_add_tenant_short_code
-- Name: Add short_code column to tenants for structured ID system
-- Dependencies: 0040_add_migration_template
-- Issue: #600

BEGIN;

-- Add short_code column — nullable for existing tenants (backfill later)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Enforce uniqueness (partial: only non-null values must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_short_code ON tenants (short_code) WHERE short_code IS NOT NULL;

-- Backfill existing tenants using a PL/pgSQL function to handle collisions
DO $$
DECLARE
  t RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT := 1;
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE short_code IS NULL ORDER BY slug LOOP
    base := upper(left(t.slug, 4));
    IF length(base) < 4 THEN
      base := rpad(base, 4, '0');
    END IF;
    candidate := base;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM tenants WHERE short_code = candidate AND id != t.id) LOOP
      candidate := base || to_char(suffix, 'FM00');
      suffix := suffix + 1;
    END LOOP;
    UPDATE tenants SET short_code = candidate WHERE id = t.id;
  END LOOP;
END $$;

COMMIT;

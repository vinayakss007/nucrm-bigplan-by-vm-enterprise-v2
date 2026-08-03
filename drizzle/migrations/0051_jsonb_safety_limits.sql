-- Migration: 0051_jsonb_safety_limits
--
-- Adds PostgreSQL functions and CHECK constraints to prevent unbounded JSONB
-- data in custom_fields and metadata columns. Protects against memory
-- exhaustion and stack overflow from deeply nested integration payloads.
--
-- Limits: 64KB serialized size, 10 nesting levels, 200 total keys.

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION jsonb_size_bytes(val jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT length(val::text)::int; $$;

CREATE OR REPLACE FUNCTION jsonb_object_keys_count(val jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT count(*)::int FROM jsonb_object_keys(val); $$;

CREATE OR REPLACE FUNCTION jsonb_depth(val jsonb)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  max_depth integer := 1;
  child_depth integer;
  item jsonb;
BEGIN
  IF jsonb_typeof(val) = 'object' THEN
    FOR item IN SELECT value FROM jsonb_each(val)
    LOOP
      child_depth := 1 + jsonb_depth(item);
      IF child_depth > max_depth THEN max_depth := child_depth; END IF;
    END LOOP;
  ELSIF jsonb_typeof(val) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements(val)
    LOOP
      child_depth := jsonb_depth(item);
      IF child_depth > max_depth THEN max_depth := child_depth; END IF;
    END LOOP;
  END IF;
  RETURN max_depth;
END;
$$;

CREATE OR REPLACE FUNCTION jsonb_key_count(val jsonb)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  cnt integer := 0;
  item jsonb;
BEGIN
  IF jsonb_typeof(val) = 'object' THEN
    cnt := cnt + jsonb_object_keys_count(val);
    FOR item IN SELECT value FROM jsonb_each(val)
    LOOP
      cnt := cnt + jsonb_key_count(item);
    END LOOP;
  ELSIF jsonb_typeof(val) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements(val)
    LOOP
      cnt := cnt + jsonb_key_count(item);
    END LOOP;
  END IF;
  RETURN cnt;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK CONSTRAINTS: custom_fields (5 tables x 3 limits = 15)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE contacts ADD CONSTRAINT chk_contacts_custom_fields_size CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_custom_fields_depth CHECK (custom_fields IS NULL OR jsonb_depth(custom_fields) <= 10);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_custom_fields_keys CHECK (custom_fields IS NULL OR jsonb_key_count(custom_fields) <= 200);

ALTER TABLE leads ADD CONSTRAINT chk_leads_custom_fields_size CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE leads ADD CONSTRAINT chk_leads_custom_fields_depth CHECK (custom_fields IS NULL OR jsonb_depth(custom_fields) <= 10);
ALTER TABLE leads ADD CONSTRAINT chk_leads_custom_fields_keys CHECK (custom_fields IS NULL OR jsonb_key_count(custom_fields) <= 200);

ALTER TABLE deals ADD CONSTRAINT chk_deals_custom_fields_size CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE deals ADD CONSTRAINT chk_deals_custom_fields_depth CHECK (custom_fields IS NULL OR jsonb_depth(custom_fields) <= 10);
ALTER TABLE deals ADD CONSTRAINT chk_deals_custom_fields_keys CHECK (custom_fields IS NULL OR jsonb_key_count(custom_fields) <= 200);

ALTER TABLE companies ADD CONSTRAINT chk_companies_custom_fields_size CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE companies ADD CONSTRAINT chk_companies_custom_fields_depth CHECK (custom_fields IS NULL OR jsonb_depth(custom_fields) <= 10);
ALTER TABLE companies ADD CONSTRAINT chk_companies_custom_fields_keys CHECK (custom_fields IS NULL OR jsonb_key_count(custom_fields) <= 200);

ALTER TABLE tasks ADD CONSTRAINT chk_tasks_custom_fields_size CHECK (custom_fields IS NULL OR jsonb_size_bytes(custom_fields) <= 65536);
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_custom_fields_depth CHECK (custom_fields IS NULL OR jsonb_depth(custom_fields) <= 10);
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_custom_fields_keys CHECK (custom_fields IS NULL OR jsonb_key_count(custom_fields) <= 200);

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK CONSTRAINTS: metadata (5 tables x 1 limit = 5)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE contacts ADD CONSTRAINT chk_contacts_metadata_size CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE leads ADD CONSTRAINT chk_leads_metadata_size CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE deals ADD CONSTRAINT chk_deals_metadata_size CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE companies ADD CONSTRAINT chk_companies_metadata_size CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_metadata_size CHECK (metadata IS NULL OR jsonb_size_bytes(metadata) <= 65536);

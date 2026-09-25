-- Migration 0095: schema-qualify recursive calls in the jsonb CHECK helpers (#2050)
--
-- pg_dump/pg_restore run the data section with `search_path = ''` (only the
-- implicit pg_catalog). jsonb_depth and jsonb_key_count referenced themselves
-- and jsonb_object_keys_count unqualified, so restoring a dump aborted with
--   ERROR: function jsonb_object_keys_count(jsonb) does not exist
-- inside every COPY whose table has custom_fields/metadata CHECK constraints
-- (companies, contacts, deals, leads, tasks, ...). The backup therefore could
-- not be restored — verified end-to-end with pg_restore into a scratch cluster.
-- Qualifying the public-schema calls makes dumps restore-safe.

CREATE OR REPLACE FUNCTION public.jsonb_depth(val jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
DECLARE
  max_depth integer := 1;
  child_depth integer;
  item jsonb;
BEGIN
  IF jsonb_typeof(val) = 'object' THEN
    FOR item IN SELECT value FROM jsonb_each(val)
    LOOP
      child_depth := 1 + public.jsonb_depth(item);
      IF child_depth > max_depth THEN max_depth := child_depth; END IF;
    END LOOP;
  ELSIF jsonb_typeof(val) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements(val)
    LOOP
      child_depth := public.jsonb_depth(item);
      IF child_depth > max_depth THEN max_depth := child_depth; END IF;
    END LOOP;
  END IF;
  RETURN max_depth;
END;
$function$;

CREATE OR REPLACE FUNCTION public.jsonb_key_count(val jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
DECLARE
  cnt integer := 0;
  item jsonb;
BEGIN
  IF jsonb_typeof(val) = 'object' THEN
    cnt := cnt + public.jsonb_object_keys_count(val);
    FOR item IN SELECT value FROM jsonb_each(val)
    LOOP
      cnt := cnt + public.jsonb_key_count(item);
    END LOOP;
  ELSIF jsonb_typeof(val) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements(val)
    LOOP
      cnt := cnt + public.jsonb_key_count(item);
    END LOOP;
  END IF;
  RETURN cnt;
END;
$function$;

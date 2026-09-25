-- Rollback for 0095: restore the original (unqualified) recursive bodies from
-- 0051. Only use this if the restore-safe qualified versions must be reverted;
-- dumping/restoring a database afterwards will hit the PP-014 CHECK-function
-- resolution failure again.

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
$function$;

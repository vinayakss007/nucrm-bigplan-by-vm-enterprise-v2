-- #3283 rollback. Two objects, and only these two: the body of the helper 0140
-- rewrote, and the bigint sibling 0140 introduced. Neither CHECK constraint is
-- touched — 0140 never rewrote any constraint expression, so there is nothing here
-- to re-attach, and no table is locked beyond the two catalog rows.
--
-- Restoring the CHARCOUNT body is the honest inverse, and it is also the reason
-- this down is safe to run: reverting re-widens what the 186 ceilings accept, so it
-- can never strand a row that a stricter ceiling already rejected. The reverse is
-- not true of the forward direction, which is why 0140's header points at the audit
-- script before it is applied.
--
-- `jsonb_size_octet_length` is dropped WITHOUT `CASCADE`. If a later migration ever
-- attaches a CHECK to it, Postgres refuses here with 2BP01 rather than silently
-- dropping that constraint — the same posture 0051's rollback took over its helpers
-- after #3284. Check the forward file before assuming this down will succeed in that
-- case; it is supposed to fail.

BEGIN;

CREATE OR REPLACE FUNCTION jsonb_size_bytes(val jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT length(val::text)::int; $$;

-- COMMENT ON's IS clause takes a string LITERAL, not an expression.

COMMENT ON FUNCTION jsonb_size_bytes(val jsonb) IS
  'Serialized size of a jsonb value, measured as length(val::text) — a CHARACTER
   count, despite the name. This is the shipped 0051 body, restored by
   0140_jsonb_size_octet_length.down.sql. #3283 explains why the 186 chk_*_size
   ceilings are 65,536 characters and not 64 KB.';

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE c.contype = 'c'
     AND t.relkind IN ('r', 'p')
     AND c.conname LIKE '%\_size'
     AND pg_get_constraintdef(c.oid) LIKE '%jsonb_size_bytes(%';

  -- RAISE's format is a single string literal, exactly as in the forward file.
  RAISE NOTICE '#3283 rolled back: % chk_*_size CHECK(s) measure characters again.
               Any row written while the BYTE ceiling was in force stays in the
               table; it was rejected at write time, so there is nothing to clean
               up, but a row accepted before 0140 and larger than its ceiling in
               bytes is now tolerated again.',
    n;
END
$$;

DROP FUNCTION IF EXISTS jsonb_size_octet_length(jsonb);

COMMIT;

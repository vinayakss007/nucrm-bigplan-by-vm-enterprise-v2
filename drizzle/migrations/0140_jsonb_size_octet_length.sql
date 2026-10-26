/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #3283 — the 186 `chk_*_size` CHECK constraints have never measured what their
-- name claims. `jsonb_size_bytes` returned `length(val::text)`: a CHARACTER count.
-- Measured on a database built from the shipped journal (0000..0138: 139 migrations,
-- 3,185 statements, 301 RLS policies), not inferred from the text:
--
--   constraints calling it    186   across   126 tables, every one of them ceilinged
--   at the literal 65536 — a number chosen in 0051's header as "64KB serialized
--   size", which is a byte figure. It was never enforced as one.
--   dependencies on the helper 186, ALL of type pg_constraint (deptype 'n'). Zero
--   indexes, zero views, zero generated columns, zero app-side SQL — so changing
--   the body changes write-time validation and nothing that is already stored.
--   names in the migration text 189, three more than the catalog: `0055` also adds
--   `chk_pipeline_stages_metadata_size`, `chk_tenant_backups_metadata_size` and
--   `chk_tenant_restores_metadata_size`, and those tables are dropped later, so the
--   constraints leave with them. A static screen reads 189 and a live query reads
--   186; both are correct and neither is a bug to "fix".
--
-- The gap is encoding-sized. A payload of 60,000 U+1F642 glyphs serialises to
-- 60,009 characters and 240,009 bytes: the helper measured 60,009, the ceiling
-- read 65536, and the row was ACCEPTED — 3.7x the intended storage, and it is
-- still in the table. The same insert against the fixed body is refused with
-- `new row for relation "tenants" violates check constraint
--  "chk_tenants_metadata_size"` — with no constraint touched, because a CHECK
-- re-evaluates the function it calls.
--
-- WHY THIS FILE REPLACES THE BODY INSTEAD OF REWRITING THE CONSTRAINTS. Postgres
-- will not let the existing helper be replaced with a better-typed one:
--   CREATE OR REPLACE FUNCTION jsonb_size_bytes(val jsonb) RETURNS bigint
--     ERROR: cannot change return type of existing function
--     HINT:  Use DROP FUNCTION jsonb_size_bytes(jsonb) first.
-- and the drop it hints at is itself refused while the constraints exist:
--   DROP FUNCTION public.jsonb_size_bytes(jsonb)
--     ERROR: cannot drop function jsonb_size_bytes(jsonb) because other objects
--            depend on it  (SQLSTATE 2BP01, 186 constraints listed)
-- So `integer` is kept for the 186 constraints that already call it, the body is
-- corrected in place (one word), and ask 2's `bigint` is delivered as
-- `jsonb_size_octet_length` for every constraint written from now on. Rewriting
-- 186 constraints onto the bigint sibling instead would take ACCESS EXCLUSIVE on
-- 126 tables until the last re-add, and `ADD CONSTRAINT … CHECK` full-scans each
-- table while validating — a write outage on the busiest tables in the schema
-- (`audit_logs`, `form_submissions`, `notifications`) to buy a wider integer type
-- that 65536 will never need. `octet_length(text)` returns `integer` and the
-- largest text a row can hold is well inside it, so nothing is lost.
--
-- IMMUTABILITY HOLDS, AND IS THE OTHER REASON TO KEEP THE NAME. `octet_length`
-- depends on the database server_encoding, which is fixed for the lifetime of the
-- database (`UTF8` here) — so the function stays genuinely IMMUTABLE, which a CHECK
-- constraint requires. A `CREATE OR REPLACE` on an IMMUTABLE function called by a
-- CHECK is accepted; that is what makes the one-word fix possible at all.
--
-- WHAT SHIPS UNAPPLIED. Per #2537 the backlog is applied by the owner's deploy, not
-- by whoever fixes this. Read `scripts/audit-jsonb-byte-overage.mjs` BEFORE
-- applying: tightening this ceiling starts rejecting rows that are already stored,
-- because CHECK constraints are only evaluated on write and Postgres never
-- re-validates them. The audit names the tables and counts the rows that exceed the
-- byte ceiling today; on the chain-built scratch database it finds exactly the
-- probe row above and nothing else.

BEGIN;

-- ── 1. the correction: measure bytes, in the same signature the 186 CHECKs bind ──
CREATE OR REPLACE FUNCTION jsonb_size_bytes(val jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT octet_length(val::text); $$;

-- COMMENT ON's IS clause takes a string LITERAL, not an expression: `IS 'a' || 'b'`
-- is a syntax error. Both comments below are therefore single literals.

COMMENT ON FUNCTION jsonb_size_bytes(val jsonb) IS
  'Serialized size of a jsonb value in BYTES: octet_length of its text form.
   Until #3283 this returned length(val::text) — a CHARACTER count — so the 186
   chk_*_size CHECKs that call it ceilinged 65,536 characters, not the 64 KB their
   names and 0051''s header claimed; for multi-byte payloads the two differ by the
   encoding factor (up to 4x under UTF8). The unit is now true to the name.
   IMMUTABLE because octet_length(text) depends only on the database
   server_encoding, which is fixed per database. Prefer
   jsonb_size_octet_length(jsonb) (bigint) for new constraints.';

-- ── 2. ask 2, delivered where it is attainable: a bigint byte measure ───────────
CREATE OR REPLACE FUNCTION jsonb_size_octet_length(val jsonb)
RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT octet_length(val::text)::bigint; $$;

COMMENT ON FUNCTION jsonb_size_octet_length(val jsonb) IS
  '#3283. The bigint form of the byte measure, for CHECK constraints written from
   this migration on. It exists as a NEW name because Postgres refuses to change
   the return type of an existing function (42P13) and refuses to drop
   jsonb_size_bytes while its 186 constraints depend on it (2BP01) — the type could
   only be widened by rebuilding every constraint that uses it.';

-- ── 3. what the rewrite just tightened, counted where a reader can find it ──────
-- The NOTICE below is visible to `psql -f` and to any owner applying this by hand;
-- `npm run db:migrate` goes through drizzle-orm's migrator, which swallows NOTICE
-- output (measured: 0 lines mentioning #3283 in its log). The durable record of the
-- count is the two COMMENT ON entries and the audit script, not this NOTICE.
DO $$
DECLARE
  n         integer;
  ceiling   text;
BEGIN
  SELECT count(*), min((regexp_match(pg_get_constraintdef(c.oid),
                                     'jsonb_size_bytes\([^)]*\)\s*<=\s*([0-9]+)'))[1])
    INTO n, ceiling
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE c.contype = 'c'
     AND t.relkind IN ('r', 'p')
     AND t.relnamespace NOT IN (pg_my_temp_schema(), 'pg_catalog'::regnamespace,
                                'information_schema'::regnamespace)
     AND c.conname LIKE '%\_size'
     AND pg_get_constraintdef(c.oid) LIKE '%jsonb_size_bytes(%';

  -- RAISE's format, like COMMENT ON's IS clause, is a single string literal — an
  -- expression built with || does not parse here either.
  RAISE NOTICE '#3283: % chk_*_size CHECK constraint(s) now measure BYTES
               (smallest ceiling %). Rows already stored are NOT re-validated —
               run scripts/audit-jsonb-byte-overage.mjs before relying on the
               ceiling as a storage bound.',
    n, coalesce(ceiling, 'n/a');
END
$$;

COMMIT;

-- 0126: give segment_members the key its schema always declared (#2515).
--
-- WHY
-- ---
-- `drizzle/schema/segments.ts` declares `id: utils.pk()` — `uuid('id')
-- .primaryKey().defaultRandom()` (drizzle/schema/utils.ts:45) — and no build
-- this repo can produce has ever enforced that. 0000_init created the table
-- without an `id` at all; 0071 added the column (`uuid DEFAULT
-- gen_random_uuid()`, nullable); 0125 made it NOT NULL and explicitly
-- stopped short of the key ("NOT IN THIS MIGRATION, and deliberately so").
-- Today `pg_constraint` for the table returns two FKs and contype 'p'
-- returns nothing, on the chain build and on preprod alike — while the only
-- index that looks like a key, `idx_segment_members_pk`, is a NON-UNIQUE
-- btree over `(segment_id, entity_id)`: its name asserts a constraint the
-- database does not carry, on two columns that are not the key. Rows the
-- bulk-enroll paths insert with `onConflictDoNothing()`
-- (app/api/tenant/leads/bulk/route.ts:326 and siblings) therefore never
-- conflict — the anti-duplication the callers assume has nothing to collide
-- with, and duplicate memberships accumulate silently.
--
-- THE DECISION (#2515 AC1)
-- ------------------------
-- BOTH readings are real, and the fix enforces both: `id` is the declared
-- key — the schema says so, 0071 minted it with `gen_random_uuid()`, and
-- `utils.pk()` is the codebase-wide convention — so `PRIMARY KEY (id)` is
-- added; and `(segment_id, entity_id)` is the table's *identity in practice*
-- — no code path addresses a member by `id` (members routes query and
-- delete by segment/tenant only), and the callers already behave as if the
-- pair were unique. The misleading `idx_segment_members_pk` is replaced by
-- `uq_segment_members_segment_entity` — a UNIQUE btree over the same two
-- columns, which also serves the lookup role AC4 keeps, so no separate
-- plain index is minted for those columns.
--
-- RLS (#2516 / PP-058 — this is why the repair is a loop)
-- -------------------------------------------------------
-- `segment_members` is tenant-isolated by a policy built in the
-- `0031_rls_remaining_tables.sql` `format()`/`EXECUTE` loop, and the marker
-- `0109` uses is **inert** on it: PP-067 measured `UPDATE 0` under
-- `set_config('app.is_super_admin', …)` on these very tables. Every write
-- below therefore runs under `set_config('app.current_tenant', …)`, per
-- tenant — the same shape 0125 uses for `custom_entities` — and the
-- duplicate checks run BEFORE any constraint statement (AC2), as dedupe, not
-- as a diagnostic. `CREATE UNIQUE INDEX` / `ADD PRIMARY KEY` read the whole
-- heap regardless of policy, so a leftover duplicate aborts the run loudly
-- rather than producing a half-keyed table; the two shapes that can still
-- abort (below) abort with the constraint's own error, never silently.
--
-- WHAT THE LOOP CANNOT REACH, stated honestly:
--   * an `id` shared by rows of two DIFFERENT tenants — each tenant context
--     sees only its own rows, so no migration can repair that blind spot;
--     v4 uuids make it a practical nullity, and `ADD PRIMARY KEY` itself
--     (DDL, RLS-blind) will refuse the table with 23505 if it ever exists;
--   * a member row whose `segment_id` points at a segment of no tenant —
--     the orphan fix below adopts the segment's tenant, and the FK guarantees
--     a segment exists, so this is the same case seen one layer up.
--
-- IDEMPOTENCY: every step is guarded — the repair loop runs only while the
-- table has no primary key, `ADD CONSTRAINT` sits behind the same `pg_constraint`
-- check, and the index statements are `DROP … IF EXISTS` / `CREATE … IF NOT
-- EXISTS`. Re-running after success is a no-op.

-- (a) per-tenant repair, then (b) the key — one guard so the dedupe can
-- never be skipped on a table that still lacks the constraint.
DO $$
DECLARE
  t RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.segment_members'::regclass
       AND contype  = 'p'
  ) THEN
    FOR t IN SELECT id FROM public.tenants LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      -- orphan membership rows first: adopt the owning segment's tenant so
      -- the two dedupes below partition over them correctly.
      UPDATE "segment_members" m
         SET "tenant_id" = s."tenant_id"
        FROM "segments" s
       WHERE m."segment_id" = s."id"
         AND m."tenant_id" IS NULL
         AND s."tenant_id" = t.id;
      -- duplicate (segment_id, entity_id): keep the earliest added_at,
      -- `id` as the deterministic tie-break.
      DELETE FROM "segment_members"
       WHERE ctid IN (
         SELECT d.ctid FROM (
           SELECT ctid,
                  row_number() OVER (PARTITION BY "segment_id", "entity_id"
                                     ORDER BY "added_at" NULLS LAST, "id") AS rn
             FROM "segment_members"
            WHERE "tenant_id" = t.id
         ) d WHERE d.rn > 1
       );
      -- duplicate ids inside one tenant: re-key all but the earliest row.
      UPDATE "segment_members"
         SET "id" = gen_random_uuid()
       WHERE ctid IN (
         SELECT d.ctid FROM (
           SELECT ctid,
                  row_number() OVER (PARTITION BY "id"
                                     ORDER BY "added_at" NULLS LAST) AS rn
             FROM "segment_members"
            WHERE "tenant_id" = t.id
              AND "id" IN (
                SELECT "id" FROM "segment_members"
                 WHERE "tenant_id" = t.id
                 GROUP BY "id" HAVING count(*) > 1
              )
         ) d WHERE d.rn > 1
       );
    END LOOP;

    ALTER TABLE "segment_members"
      ADD CONSTRAINT "segment_members_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
--> statement-breakpoint
-- (c) retire the name that asserted a constraint the table did not carry,
-- and carry the pair's real uniqueness in its place (AC3 + AC4: this UNIQUE
-- btree is also the lookup index the old one was).
DROP INDEX IF EXISTS "idx_segment_members_pk";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_segment_members_segment_entity"
    ON "segment_members" USING btree ("segment_id", "entity_id");

/**
 * #2515 — segment_members gets the key its schema always declared.
 *
 * `drizzle/schema/segments.ts` says `id: utils.pk()`; the database never had
 * one, and the only index shaped like a key (`idx_segment_members_pk`) was a
 * NON-UNIQUE btree over `(segment_id, entity_id)` — so the bulk-enroll
 * callers' `onConflictDoNothing()` had nothing to conflict with. `0126`
 * repairs both readings and must obey the RLS rules this repo learned the
 * hard way (PP-058, PP-067, #2516): the dedupe writes run under
 * `app.current_tenant` per tenant — `app.is_super_admin` is inert on this
 * table's policy — and the duplicate elimination runs BEFORE any constraint
 * statement, not as a diagnostic after it.
 *
 * These are text-level pins on the real migration file, not fixtures: the
 * file is what CI's chain build will execute, and every ordering claim below
 * is one the deployed database can disprove only after the fact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  stripComments,
  executableScope,
} from '../../scripts/check-migration-rls-dml.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const UP = readFileSync(
  join(ROOT, 'drizzle/migrations/0126_segment_members_primary_key.sql'),
  'utf8',
);
const DOWN = readFileSync(
  join(ROOT, 'drizzle/migrations/0126_segment_members_primary_key.down.sql'),
  'utf8',
);
const SCOPE = executableScope(stripComments(UP));

describe('0126 up — the writes obey the RLS rules (PP-058 / PP-067 / #2516)', () => {
  it('sets app.current_tenant before the first write', () => {
    const setter = SCOPE.search(/set_config\(\s*'app\.current_tenant'/i);
    const firstWrite = SCOPE.search(/\bUPDATE "segment_members"/i);
    expect(setter).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(setter).toBeLessThan(firstWrite);
  });

  it('does NOT rely on the super-admin marker, which PP-067 measured inert here', () => {
    // The header prose mentions it to say it does not work; the executable
    // scope must not set it as if it did.
    expect(SCOPE).not.toMatch(/set_config\(\s*'app\.is_super_admin'/i);
  });

  it('every row-DML statement sits inside the per-tenant loop', () => {
    // The loop is opened by `FOR t IN SELECT id FROM public.tenants LOOP` and
    // closed before ALTER TABLE; anything outside would run in no tenant
    // context and match zero rows (PP-058's exact failure mode).
    const open = SCOPE.indexOf('LOOP', SCOPE.indexOf('FOR t IN'));
    const close = SCOPE.indexOf('END LOOP');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    for (const m of SCOPE.matchAll(/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+"?segment_members"?/gi)) {
      expect(m.index).toBeGreaterThan(open);
      expect(m.index).toBeLessThan(close);
    }
  });

  it('deduplicates before constraining — AC2', () => {
    const dedupe = SCOPE.search(/DELETE FROM "segment_members"/i);
    const rekey = SCOPE.search(/SET "id" = gen_random_uuid\(\)/i);
    const pk = SCOPE.indexOf('ADD CONSTRAINT "segment_members_pkey" PRIMARY KEY');
    const uniq = SCOPE.search(/CREATE UNIQUE INDEX/i);
    expect(dedupe).toBeGreaterThan(-1);
    expect(rekey).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(pk);
    expect(rekey).toBeLessThan(pk);
    expect(pk).toBeLessThan(uniq);
  });

  it('adopts the owning segment tenant for orphan rows before the pair dedupe', () => {
    const orphanFix = SCOPE.search(/SET "tenant_id" = s\."tenant_id"/i);
    const dedupe = SCOPE.search(/DELETE FROM "segment_members"/i);
    expect(orphanFix).toBeGreaterThan(-1);
    expect(orphanFix).toBeLessThan(dedupe);
  });
});

describe('0126 up — the constraints and the honest names (AC1/AC3/AC4)', () => {
  it('adds PRIMARY KEY (id), matching utils.pk()', () => {
    expect(SCOPE).toMatch(/ADD CONSTRAINT "segment_members_pkey" PRIMARY KEY \("id"\)/);
  });

  it('replaces the misleading index name with a UNIQUE btree over the same pair', () => {
    expect(SCOPE).toMatch(/DROP INDEX IF EXISTS "idx_segment_members_pk"/);
    expect(SCOPE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "uq_segment_members_segment_entity"\s+ON "segment_members" USING btree \("segment_id", "entity_id"\)/i,
    );
  });

  it('is idempotent: the key guard wraps the repair, the index forms are IF-[NOT-]EXISTS', () => {
    expect(SCOPE).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/i);
    expect(SCOPE).toMatch(/contype\s*=\s*'p'/i);
    expect(SCOPE).toMatch(/DROP INDEX IF EXISTS/i);
    expect(SCOPE).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
  });
});

describe('0126 down — rolls back to honest shapes only', () => {
  it('drops the constraint and the unique index', () => {
    const d = executableScope(stripComments(DOWN));
    expect(d).toMatch(/DROP CONSTRAINT IF EXISTS "segment_members_pkey"/);
    expect(d).toMatch(/DROP INDEX IF EXISTS "uq_segment_members_segment_entity"/);
  });

  it('does NOT resurrect the misleading name', () => {
    const d = executableScope(stripComments(DOWN));
    expect(d).not.toMatch(/idx_segment_members_pk/);
    expect(d).toMatch(/CREATE INDEX IF NOT EXISTS "idx_segment_members_segment_entity"/);
  });
});

describe('the repo agrees with the migration', () => {
  it('drizzle/schema/segments.ts declares the unique index, not the fake-pk one', () => {
    const schema = readFileSync(join(ROOT, 'drizzle/schema/segments.ts'), 'utf8');
    expect(schema).toContain("uniqueIndex('uq_segment_members_segment_entity')");
    const live = stripComments(schema);
    expect(live).not.toContain('idx_segment_members_pk');
    expect(live).toMatch(/import \{[^}]*\buniqueIndex\b[^}]*\} from 'drizzle-orm\/pg-core'/);
  });

  it('the journal carries 0126 at idx 126', () => {
    const j = JSON.parse(
      readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    );
    const e = j.entries.at(-1);
    expect(e.tag).toBe('0126_segment_members_primary_key');
    expect(e.idx).toBe(126);
    expect(e.breakpoints).toBe(true);
  });
});

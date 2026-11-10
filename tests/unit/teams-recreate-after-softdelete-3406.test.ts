/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying, distribution or use is prohibited.
 */

/**
 * #3406 — a deleted row must not keep its key reserved.
 *
 * `idx_teams_tenant_name` was unique on (tenant_id, name) with no WHERE clause,
 * so the round trip "trash the team Sales → type Sales again" died with 23505:
 * "that name is already in use", for a name every list query hides with
 * `deletedAt IS NULL`. The inverse defect sat in the tables that WERE partial:
 * a key taken while a tombstone held it meant the collision surfaced at restore
 * time as an unexplained 23505 rather than as the deliberate loud failure the
 * audit asked for.
 *
 * Migration 0144 makes the rule uniform — uniqueness now means "unique among
 * live rows" across all 27 converted surfaces — and scripts/
 * check-partial-unique-indexes.mts keeps it uniform. This file pins the three
 * things a future edit can silently undo:
 *
 *   1. the database: teams' unique surface is partial on deleted_at, under a
 *      name the schema can actually claim, and the old tombstone-blind index
 *      is gone;
 *   2. the schema: `drizzle/schema/teams.ts` declares that same partial
 *      surface, so the next generated migration cannot undo it (a schema that
 *      lies about an index is how a bound surface goes UNBOUND);
 *   3. the rollback: every index 0144 creates, its .down file rebuilds under
 *      the original name — restore-to-tombstone-blind must be possible.
 *
 * The live behaviour — 23505 gone for delete-then-retype, 23505 present for
 * restore-onto-taken — is Postgres's, not this file's; it is exercised by the
 * CI job `guard:partial-unique` (package.json → scripts/
 * check-partial-unique-indexes.mts), which re-derives every unique surface on
 * a soft-deletable table from the migration corpus itself.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const UP = readFileSync(join(ROOT, 'drizzle/migrations/0144_partial_unique_indexes_for_recreate.sql'), 'utf8');
const DOWN = readFileSync(join(ROOT, 'drizzle/migrations/0144_partial_unique_indexes_for_recreate.down.sql'), 'utf8');
const TEAMS_SCHEMA = readFileSync(join(ROOT, 'drizzle/schema/teams.ts'), 'utf8');
const JOURNAL = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'));

/** Every `CREATE UNIQUE INDEX CONCURRENTLY … ON [public.]t (…) WHERE deleted_at IS NULL;` in 0144. */
function convertedSurfaces(src: string) {
  return [...src.matchAll(
    /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "([^"]+)" ON (?:[\w"]+\.)?"([\w]+)"\s*\(([^)]*)\)\s*WHERE deleted_at IS NULL([^;]*);/g,
  )].map((m) => ({ name: m[1]!, table: m[2]!, columns: m[3]! }));
}

describe('#3406 teams — the user-visible round trip', () => {
  it('replaces the tombstone-blind unique index with a partial one on (tenant_id, name)', () => {
    const up = convertedSurfaces(UP).find((s) => s.name === 'idx_teams_tenant_name_live');
    expect(up, '0144 does not create the partial teams index').toBeDefined();
    expect(up!.table).toBe('teams');
    expect(up!.columns).toBe('"tenant_id", "name"');
    expect(UP).toMatch(/DROP INDEX CONCURRENTLY IF EXISTS "idx_teams_tenant_name"/);
  });

  it('the schema declares the same partial surface, not the old one', () => {
    expect(TEAMS_SCHEMA).toMatch(/uniqueIndex\('idx_teams_tenant_name_live'\)\.on\(table\.tenantId, table\.name\)\.where\(sql`\$\{table\.deletedAt\} IS NULL`\)/);
    expect(TEAMS_SCHEMA, 'schema still declares the tombstone-blind index the migration dropped').not.toMatch(/uniqueIndex\('idx_teams_tenant_name'\)/);
  });
});

describe('#3406 the whole conversion is internally consistent', () => {
  it('every converted index is partial on deleted_at and named *_live', () => {
    const surfaces = convertedSurfaces(UP);
    // 27, the number `guard:partial-unique` reports as the post-0144 delta
    // (59 surfaces on soft-deletable tables, 7 already partial, 25 declared
    // absolute). Pinned exactly: a parser that stops seeing the DDL — a schema
    // qualifier, a line wrap — must fail here rather than assert over nothing.
    expect(surfaces.length).toBe(27);
    for (const s of surfaces) expect(s.name.endsWith('_live'), `${s.name} keeps the old name — the DROP in the same file would delete its own work`).toBe(true);
  });

  it('no CREATE under an old name is shadowed by its own DROP', () => {
    const created = new Set(convertedSurfaces(UP).map((s) => s.name));
    for (const drop of UP.matchAll(/(?:DROP INDEX|ALTER TABLE "\w+" DROP CONSTRAINT) CONCURRENTLY IF EXISTS "([^"]+)"|DROP CONSTRAINT IF EXISTS "([^"]+)"/g)) {
      const name = drop[1] ?? drop[2];
      expect(created.has(name), `0144 drops ${name} and never replaces it — the surface stops guarding`).toBe(false);
    }
  });

  it('the rollback rebuilds every converted surface under its original name', () => {
    // One surface does not come back under the name the up file also drops: forms'
    // pre-0144 arm was the `forms_slug_unique` constraint, and `idx_forms_slug` was
    // 0116's (#2264) duplicate of it. Rebuilding that index would re-introduce the
    // duplicate 0116 removed, so the down file restores the constraint instead.
    const ROLLBACK_UNDER: Record<string, string> = { idx_forms_slug_live: 'forms_slug_unique' };
    for (const s of convertedSurfaces(UP)) {
      const original = ROLLBACK_UNDER[s.name] ?? s.name.replace(/_live$/, '');
      expect(UP.includes(`"${s.name}"`) && DOWN.includes(`"${original}"`), `down file does not rebuild ${original}`).toBe(true);
    }
    expect(DOWN.match(/CREATE UNIQUE INDEX IF NOT EXISTS "idx_teams_tenant_name"/), 'teams rollback missing').not.toBeNull();
    expect(DOWN, 'the rollback re-mints a duplicate 0116 already dropped').not.toMatch(/CREATE UNIQUE INDEX[^;]*"idx_forms_slug"/);
  });

  it('the journal carries 0144 exactly once, after 0143', () => {
    const tags = JOURNAL.entries.map((e: { tag: string }) => e.tag);
    expect(tags.filter((t: string) => t.startsWith('0144_'))).toEqual(['0144_partial_unique_indexes_for_recreate']);
    expect(tags.indexOf('0144_partial_unique_indexes_for_recreate')).toBe(tags.indexOf('0143_scim_users_tenant_context') + 1);
    const idxs = JOURNAL.entries.map((e: { idx: number }) => e.idx);
    expect(new Set(idxs).size, 'duplicate journal idx (#682 class)').toBe(idxs.length);
  });
});

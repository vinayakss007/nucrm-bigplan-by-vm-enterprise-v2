/**
 * #2509 — static guard for migration 0125_declared_not_null_columns.
 *
 * Shape copied from its sibling,
 * tests/unit/schema/webhook-events-created-at-not-null-migration.test.ts —
 * 0109_webhook_events_created_at_not_null is the worked example for this class
 * of file. What this suite protects is the shape, because the end state is only
 * assertable against a chain-built database and CI's Integration job builds its
 * schema with `npm run db:sync` (drizzle-kit push), which enforces these six
 * columns from the Drizzle declaration no matter what the chain does. That is
 * the two-install-path divergence #2509 is about, so a test written against the
 * db:sync database would be green for the wrong reason.
 * The chain side is measured by `npm run db:bootstrap` + `scripts/drift-check.ts`
 * in CI's fresh-install job (#2512) and locally for this PR.
 *
 *   - registered in _journal.json (scripts/migrate.ts is journal-driven; an
 *     unregistered file is never applied to any environment);
 *   - NOT tagged like an RLS migration, so apply-rls-ci.mjs does not pick it up;
 *   - the backfill reaches its rows through `app.current_tenant`, which is the
 *     GUC custom_entities / custom_entity_data / segment_members policies
 *     actually branch on — `app.is_super_admin` alone was MEASURED inert here
 *     (UPDATE 0, then 23502 on the ALTER), unlike 0109's webhook_events;
 *   - every per-tenant UPDATE carries its own tenant predicate;
 *   - each block is catalogue-guarded on is_nullable = 'YES' (idempotent);
 *   - exactly the six declared columns get SET NOT NULL, and nothing else;
 *   - the fix is ALTER-based: it must never become a third `CREATE TABLE IF
 *     NOT EXISTS`, which is the shape that made 0071 inert for six years of
 *     chain builds;
 *   - the down migration relaxes nullability only and never touches rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const TAG = '0125_declared_not_null_columns';
const UP_FILE = join(MIGRATIONS_DIR, `${TAG}.sql`);
const DOWN_FILE = join(MIGRATIONS_DIR, `${TAG}.down.sql`);
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const sql = readFileSync(UP_FILE, 'utf8');
const downSql = readFileSync(DOWN_FILE, 'utf8');
const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

/** Comment-free text, so prose in the header cannot satisfy an assertion. */
const executable = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const SIX: Array<[string, string]> = [
  ['custom_entities', 'fields'],
  ['custom_entities', 'settings'],
  ['custom_entities', 'created_at'],
  ['custom_entity_data', 'data'],
  ['custom_entity_data', 'created_at'],
  ['segment_members', 'id'],
];

describe(`migration ${TAG} (#2509)`, () => {
  it('is registered in _journal.json with increasing idx/when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const pos = journal.entries.indexOf(entry!);
    expect(pos).toBeGreaterThan(0);
    const prev = journal.entries[pos - 1];
    expect(entry!.idx).toBeGreaterThan(prev.idx);
    expect(entry!.when).toBeGreaterThan(prev.when);
    // #2262: idx === journal position, pinned rather than the absolute number.
    expect(entry!.idx).toBe(pos);
    expect(entry!.breakpoints).toBe(true);
  });

  it('is NOT mislabeled as an RLS migration (stays out of apply-rls-ci discovery)', () => {
    // In sync with RLS_TAG_RE in scripts/apply-rls-ci.mjs.
    expect(TAG).not.toMatch(/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i);
  });

  it('drives the backfill with the GUC these three policies read', () => {
    // custom_entities / custom_entity_data: USING (current_setting(
    // 'app.current_tenant', true) <> '' AND tenant_id = …::uuid) — set by 0059
    // and re-stated by 0088. Neither branches on app.is_super_admin, so a
    // migration that copies 0109's GUC and stops backfills 0 rows.
    expect(executable).toMatch(/set_config\('app\.current_tenant',\s*t\.id::text,\s*true\)/);
    expect(executable).toMatch(/FOR t IN SELECT id FROM public\.tenants LOOP/);
    // Kept because guard:migration-rls (PP-058) recognises it as the marker for
    // a write that is not RLS-blind; measured inert for these three policies.
    expect(executable).toMatch(/set_config\('app\.is_super_admin',\s*'true',\s*true\)/);
  });

  it('scopes every per-tenant UPDATE to the tenant it is running for', () => {
    const updates = executable.match(/UPDATE "[a-z_]+"[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(3);
    for (const u of updates) {
      expect(u, `UPDATE without a tenant predicate is a cross-tenant write:\n${u}`).toContain('"tenant_id"');
    }
  });

  it('is idempotent: every block is guarded on the catalogue', () => {
    const blocks = executable.match(/DO \$\$[\s\S]*?\$\$/g) ?? [];
    expect(blocks.length).toBe(3);
    for (const b of blocks) {
      expect(b, 'every block must open on the catalogue').toMatch(/information_schema\.columns/);
      expect(b).toMatch(/table_schema\s*=\s*'public'/);
      expect(b).toMatch(/is_nullable\s*=\s*'YES'/);
    }
  });

  it('enforces exactly the six declared columns with SET NOT NULL', () => {
    const stmts = executable.match(/ALTER TABLE "\w+" ALTER COLUMN "\w+" SET NOT NULL/g) ?? [];
    expect(stmts.sort()).toEqual(
      SIX.map(([t, c]) => `ALTER TABLE "${t}" ALTER COLUMN "${c}" SET NOT NULL`).sort(),
    );
    for (const [t, c] of SIX) {
      expect(executable, `${t}.${c} must be constrained`).toContain(
        `ALTER TABLE "${t}" ALTER COLUMN "${c}" SET NOT NULL`,
      );
    }
  });

  it('repairs by ALTER, never by a third CREATE TABLE IF NOT EXISTS', () => {
    // 0071_schema_drift_backfill.sql:60 re-CREATEs custom_entities with the
    // NOT NULLs in its column list. On any chain-built database 0059 already
    // made that table, so the statement is a no-op and the NOT NULLs never
    // execute — the defect #2509 names. This file must not repeat it.
    expect(executable).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?)(custom_entities|custom_entity_data|segment_members)/i);
    // And the inert pair stays where it is: 0071 is not rewritten in this PR.
    const backfill = readFileSync(join(MIGRATIONS_DIR, '0071_schema_drift_backfill.sql'), 'utf8');
    expect(backfill).toMatch(/CREATE TABLE IF NOT EXISTS custom_entities/);
  });

  it('names the six in the header so the next reader finds the cause', () => {
    expect(sql).toContain('0059_custom_entities.sql');
    expect(sql).toContain('0071_schema_drift_backfill.sql');
    expect(sql).toContain('utils.pk()');
    expect(sql).toContain('segment_members.id');
  });

  it('down migration relaxes the six and never touches rows', () => {
    const stmts = downSql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .match(/ALTER TABLE "\w+" ALTER COLUMN "\w+" DROP NOT NULL/g) ?? [];
    expect(stmts.sort()).toEqual(
      SIX.map(([t, c]) => `ALTER TABLE "${t}" ALTER COLUMN "${c}" DROP NOT NULL`).sort(),
    );
    expect(downSql).not.toMatch(/DELETE|TRUNCATE|DROP TABLE|DROP NOT NULL\s+\(/i);
  });

  it('the Drizzle declarations this migration now matches are still notNull', () => {
    const custom = readFileSync(join(ROOT, 'drizzle/schema/custom-entities.ts'), 'utf8');
    expect(custom).toContain("jsonb('fields').notNull().default([])");
    expect(custom).toContain("jsonb('settings').notNull().default('{}')");
    expect(custom).toContain("jsonb('data').notNull().default('{}')");
    const utils = readFileSync(join(ROOT, 'drizzle/schema/utils.ts'), 'utf8');
    // created_at for both tables, and segment_members.id, come from helpers.
    expect(utils).toMatch(/export const createdAt = \(\) => timestamp\('created_at', \{ withTimezone: true \}\)\.defaultNow\(\)\.notNull\(\)/);
    expect(utils).toMatch(/export const pk = \(\) => uuid\('id'\)\.primaryKey\(\)\.defaultRandom\(\)/);
    const segments = readFileSync(join(ROOT, 'drizzle/schema/segments.ts'), 'utf8');
    expect(segments).toMatch(/export const segmentMembers = pgTable\('segment_members', \{\s*id: utils\.pk\(\)/);
  });
});

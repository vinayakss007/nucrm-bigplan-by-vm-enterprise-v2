import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('Schema Migration Coverage (Issue #219)', () => {
  const schemaDir = join(import.meta.dirname!, '../../drizzle/schema');
  const migrationsDir = join(import.meta.dirname!, '../../drizzle/migrations');

  /**
   * The migration that adds dunning/csat/canned-response tables.
   *
   * #814 renumbered it from 0036_missing_tables to 0033_missing_tables while
   * resolving migration numbering collisions. Git records it as R100 — a pure
   * rename, identical content. Referenced through a constant so a future
   * renumbering is a one-line change rather than four.
   */
  const MISSING_TABLES_TAG = '0033_missing_tables';

  function extractPgTables(dir: string): Set<string> {
    const tables = new Set<string>();
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !['_registry.ts', 'index.ts', 'utils.ts'].includes(f),
    );
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8');
      const matches = content.matchAll(/pgTable\s*\(\s*['"`]([^'"`]+)['"`]/g);
      for (const m of matches) tables.add(m[1]);
    }
    return tables;
  }

  function extractMigratedTables(dir: string): Set<string> {
    const tables = new Set<string>();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8');
      const matches = content.matchAll(
        /CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/gi,
      );
      for (const m of matches) tables.add(m[1].toLowerCase());
    }
    return tables;
  }

  it('should have every schema table covered by at least one migration', () => {
    const schemaTables = extractPgTables(schemaDir);
    const migratedTables = extractMigratedTables(migrationsDir);

    const missing = [...schemaTables].filter((t) => !migratedTables.has(t));

    expect(missing).toEqual([]);
  });

  // Deliberate tripwire: adding a table should be a conscious act, so this count
  // is updated by hand alongside the migration that creates it. The test above is
  // what actually guarantees coverage; this one stops a table appearing silently.
  //
  // 219 -> 220: record_links (0044_cross_module_record_linking).
  // 220 -> 222: teams + team_members (0046_teams).
  it('should have exactly 222 tables defined in schema', () => {
    const schemaTables = extractPgTables(schemaDir);
    expect(schemaTables.size).toBe(222);
  });

  it('the missing-tables migration creates all 4 tables', () => {
    const sql = readFileSync(
      join(migrationsDir, `${MISSING_TABLES_TAG}.sql`),
      'utf8',
    );

    const expectedTables = [
      'dunning_settings',
      'dunning_attempts',
      'csat_surveys',
      'canned_responses',
    ];

    for (const table of expectedTables) {
      const regex = new RegExp(
        `CREATE\\s+TABLE\\s+(?:IF NOT EXISTS\\s+)?["\`]?${table}["\`]?`,
        'i',
      );
      expect(sql).toMatch(regex);
    }
  });

  it('the missing-tables migration defines required indexes', () => {
    const sql = readFileSync(
      join(migrationsDir, `${MISSING_TABLES_TAG}.sql`),
      'utf8',
    );

    const requiredIndexes = [
      'idx_dunning_settings_tenant',
      'idx_dunning_settings_active',
      'idx_dunning_attempts_tenant',
      'idx_dunning_attempts_subscription',
      'idx_dunning_attempts_status',
      'idx_dunning_attempts_scheduled',
      'idx_csat_surveys_tenant',
      'idx_csat_ticket',
      'idx_csat_contact',
      'idx_csat_token',
      'idx_csat_responded',
      'idx_canned_responses_tenant',
      'idx_canned_shortcut',
    ];

    for (const idx of requiredIndexes) {
      expect(sql).toContain(idx);
    }
  });

  it('the missing-tables migration defines FK constraints', () => {
    const sql = readFileSync(
      join(migrationsDir, `${MISSING_TABLES_TAG}.sql`),
      'utf8',
    );

    const fkConstraints = [
      'dunning_settings_tenant_id_fk',
      'dunning_attempts_tenant_id_fk',
      'dunning_attempts_subscription_id_fk',
      'csat_surveys_tenant_id_fk',
      'csat_surveys_ticket_id_fk',
      'csat_surveys_contact_id_fk',
      'canned_responses_tenant_id_fk',
    ];

    for (const fk of fkConstraints) {
      expect(sql).toContain(fk);
    }
  });

  it('migration journal includes the missing-tables migration', () => {
    const journal = readFileSync(
      join(migrationsDir, 'meta/_journal.json'),
      'utf8',
    );
    const parsed = JSON.parse(journal);
    const tags = parsed.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain(MISSING_TABLES_TAG);
  });
});

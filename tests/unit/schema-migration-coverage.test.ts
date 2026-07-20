import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('Schema Migration Coverage (Issue #219)', () => {
  const schemaDir = join(import.meta.dirname!, '../../drizzle/schema');
  const migrationsDir = join(import.meta.dirname!, '../../drizzle/migrations');

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

  it('should have exactly 219 tables defined in schema', () => {
    const schemaTables = extractPgTables(schemaDir);
    expect(schemaTables.size).toBe(219);
  });

  it('migration 0036 should create all 4 missing tables', () => {
    const sql = readFileSync(
      join(migrationsDir, '0036_missing_tables.sql'),
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

  it('migration 0036 should define required indexes', () => {
    const sql = readFileSync(
      join(migrationsDir, '0036_missing_tables.sql'),
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

  it('migration 0036 should define FK constraints', () => {
    const sql = readFileSync(
      join(migrationsDir, '0036_missing_tables.sql'),
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

  it('migration journal should include 0036_missing_tables', () => {
    const journal = readFileSync(
      join(migrationsDir, 'meta/_journal.json'),
      'utf8',
    );
    const parsed = JSON.parse(journal);
    const tags = parsed.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain('0036_missing_tables');
  });
});

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
});

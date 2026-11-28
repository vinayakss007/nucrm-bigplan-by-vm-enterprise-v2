import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/superadmin/data-explorer/route.ts'), 'utf8');

describe('superadmin data explorer performance (#4061)', () => {
  it('caches summary and schema reads for five minutes', () => {
    expect(src).toContain("getOrSet('de:summary:platform'");
    expect(src).toContain('getOrSet(`de:summary:tenant:${tenantId}`');
    expect(src).toContain("getOrSet('de:schema:v1'");
    expect(src.split(', 300);').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('collapses the three correlated schema subqueries into one aggregate', () => {
    expect(src).toContain("bool_or(c.column_name = 'tenant_id')");
    expect(src).toContain("bool_or(c.column_name = 'deleted_at')");
    expect(src).not.toContain("(SELECT count(*) FROM information_schema.columns c");
  });

  it('reads per-table columns and row estimates in parallel', () => {
    expect(src).toContain('Promise.all(tenantTables.map(async (table) => {');
    expect(src).toContain('reltuples::bigint AS estimate');
    expect(src).not.toContain('SELECT count(*) FROM ${sql.identifier(table.table_name)}');
  });
});

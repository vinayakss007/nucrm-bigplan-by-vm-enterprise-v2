/**
 * Guard: every table the backup/export/restore code touches must be scorable to
 * exactly one tenant, and the way it is scored must match the live database.
 *
 * Three shapes exist. Most tables carry their own `tenant_id`. Six are isolated
 * by the database through a PARENT row (`tenant_isolation` uses an EXISTS against
 * contacts/leads/price_books/email_warmup_configs): four of those have no
 * `tenant_id` column at all and two carry one their policy ignores, so a
 * `WHERE tenant_id = …` against them is either a 42703 on a column that does not
 * exist or an always-empty filter. Two tables are platform-wide with no tenant
 * column at all and must never be wiped or exported per tenant.
 *
 * The first shape fails loudly, the second silently loses customer data, and
 * the third would delete every tenant's rows — so all three are asserted here,
 * against the Drizzle schema rather than a hand-maintained list.
 */

import { describe, it, expect, vi } from 'vitest';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/drizzle/schema';
import {
  TENANT_DELETE_ORDER,
  JUNCTION_TABLES,
  PLATFORM_TABLES,
  isJunctionTable,
  junctionScope,
  junctionDelete,
  tenantScope,
} from '@/lib/tenant-restore-wipe';

vi.mock('@/drizzle/db', () => ({ db: {} }));

/** physical table name -> physical column names, from the schema itself. */
const COLUMNS = (() => {
  const map = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    map.set(
      getTableName(value),
      new Set(Object.values(getTableColumns(value)).map((col) => col.name)),
    );
  }
  return map;
})();

/** The tables the live RLS policies isolate through a parent row. */
const PARENT_ISOLATED = [
  'contact_emails',
  'contact_tags',
  'lead_tags',
  'email_warmup_pool',
  'email_warmup_logs',
  'price_book_entries',
];

/** Flattened `SELECT`/`DELETE` text of a drizzle SQL fragment, params as $n. */
function flatten(fragment: unknown): { sql: string; params: unknown[] } {
  const chunks = (fragment as { queryChunks: unknown[] }).queryChunks;
  const params: unknown[] = [];
  let text = '';
  const addParam = (value: unknown): void => {
    params.push(value);
    text += `$${params.length}`;
  };
  const walk = (node: unknown): void => {
    // A bare scalar in a chunk list is always a bound value; literal SQL and
    // identifiers always arrive wrapped in `{ value: ... }`.
    if (node === undefined || node === null) return;
    if (typeof node === 'string' || typeof node === 'number' || node instanceof Date) {
      addParam(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const value = (node as { value?: unknown; queryChunks?: unknown[] }).value;
    if (value === undefined) {
      const nested = (node as { queryChunks?: unknown[] }).queryChunks;
      if (Array.isArray(nested)) nested.forEach(walk);
      return;
    }
    if (typeof value === 'string') {
      text += value;
      return;
    }
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
      text += value.join('');
      return;
    }
    walk(value);
  };
  chunks.forEach(walk);
  return { sql: text.replace(/\s+/g, ' ').trim(), params };
}

describe('junction tenant scopes', () => {
  it('covers exactly the tables the database isolates through a parent', () => {
    expect([...JUNCTION_TABLES].sort()).toEqual([...PARENT_ISOLATED].sort());
    for (const table of PARENT_ISOLATED) expect(isJunctionTable(table)).toBe(true);
  });

  it('reaches the tenant through a parent row that really has tenant_id', () => {
    for (const table of JUNCTION_TABLES) {
      const child = COLUMNS.get(table);
      expect(child, `${table} is missing from the Drizzle schema`).not.toBeNull();

      const scope = flatten(junctionScope(table, 'tenant-uuid'));
      expect(scope.params, `${table} scope does not bind the tenant`).toEqual(['tenant-uuid']);
      const match = /(\w+) IN \( SELECT id FROM (\w+) WHERE \2\.tenant_id = \$1 \)/.exec(scope.sql);
      expect(match, `${table} scope is not a parent EXISTS: ${scope.sql}`).not.toBeNull();

      const parent = COLUMNS.get(match![2]!);
      expect(parent, `parent ${match![2]} of ${table} is missing from the schema`).not.toBeNull();
      expect(parent!.has('tenant_id'), `parent ${match![2]} has no tenant_id`).toBe(true);
      expect(child!.has(match![1]!), `${table} has no ${match![1]}`).toBe(true);
    }
  });

  it('the wipe delete carries the same predicate as the read', () => {
    for (const table of JUNCTION_TABLES) {
      const del = flatten(junctionDelete(table, 'tenant-uuid'));
      const read = flatten(junctionScope(table, 'tenant-uuid'));
      expect(del.sql, table).toBe(`DELETE FROM ${table} WHERE ${read.sql}`);
    }
  });

  it('rejects a table that is not junction-scoped instead of building bad SQL', () => {
    expect(isJunctionTable('contacts')).toBe(false);
    expect(() => junctionScope('contacts', 't')).toThrow(/Unknown junction table/);
    expect(() => junctionDelete('contacts', 't')).toThrow(/Unknown junction table/);
  });

  it('resolves each of the three shapes to exactly one predicate', () => {
    for (const table of ['modules', 'announcements']) {
      expect(tenantScope(table, 'tenant-uuid'), table).toBeNull();
    }
    for (const table of JUNCTION_TABLES) {
      expect(flatten(tenantScope(table, 'tenant-uuid')!).sql).toBe(
        flatten(junctionScope(table, 'tenant-uuid')).sql,
      );
    }
    for (const table of ['contacts', 'leads', 'audit_logs', 'form_submissions']) {
      const scope = flatten(tenantScope(table, 'tenant-uuid')!);
      expect(scope.sql, table).toBe('tenant_id = $1');
      expect(scope.params, table).toEqual(['tenant-uuid']);
    }
  });
});

describe('tenant wipe order', () => {
  it('each table is platform-skipped, parent-scoped, or has its own tenant_id', () => {
    const offenders: string[] = [];
    for (const table of TENANT_DELETE_ORDER) {
      if (PLATFORM_TABLES.includes(table) || isJunctionTable(table)) continue;
      const cols = COLUMNS.get(table);
      if (cols && !cols.has('tenant_id')) offenders.push(table);
    }
    expect(offenders, 'these tables would 42703 on `WHERE tenant_id = …`').toEqual([]);
  });

  it('has no duplicate table names and names no table outside the schema', () => {
    expect(new Set(TENANT_DELETE_ORDER).size).toBe(TENANT_DELETE_ORDER.length);
    const unknown = TENANT_DELETE_ORDER.filter((t) => !COLUMNS.has(t));
    expect(unknown, 'not present in the Drizzle schema').toEqual([]);
  });

  it('never scopes a platform-wide table to one tenant', () => {
    expect(TENANT_DELETE_ORDER).toContain('modules');
    for (const table of PLATFORM_TABLES) {
      expect(isJunctionTable(table), table).toBe(false);
      expect(COLUMNS.get(table)?.has('tenant_id'), `${table} must have no tenant column`).toBe(false);
    }
  });
});

describe('tenant export table list', () => {
  // Imported after the db mock above; only the static registry is used.
  const exportRegistry = async () => (await import('@/lib/tenant-data-export')).TENANT_TABLES;

  it('filters every table on a column that exists', async () => {
    const offenders: string[] = [];
    for (const def of await exportRegistry()) {
      const cols = COLUMNS.get(def.table);
      if (!cols) continue; // raw-SQL fallback for tables with no schema export
      if (isJunctionTable(def.table) || PLATFORM_TABLES.includes(def.table)) continue;
      if (!cols.has(def.filterColumn)) offenders.push(`${def.table}.${def.filterColumn}`);
    }
    expect(offenders, 'filtering a column that does not exist exports nothing').toEqual([]);
  });

  it('never filters a foreign key against a tenant id', async () => {
    const suspects = (await exportRegistry())
      .filter((def) => !isJunctionTable(def.table) && !PLATFORM_TABLES.includes(def.table))
      .filter((def) => /_id$/.test(def.filterColumn) && def.filterColumn !== 'tenant_id')
      .map((def) => `${def.table}.${def.filterColumn}`);
    expect(suspects, 'a *_id filter other than tenant_id compares a FK to a tenant uuid').toEqual([]);
  });

  it('never filters a global table by its own id', async () => {
    const suspects = (await exportRegistry())
      .filter((def) => !isJunctionTable(def.table) && !PLATFORM_TABLES.includes(def.table))
      .filter((def) => def.filterColumn === 'id' && def.table !== 'tenants')
      .map((def) => def.table);
    expect(suspects, 'id = tenant uuid matches nothing and would export global rows on restore').toEqual([]);
  });

  it('exports every table the restore wipe deletes, and skips the platform ones', async () => {
    const exported = new Set(await exportRegistry().then((defs) => defs.map((d) => d.table)));
    const missing = TENANT_DELETE_ORDER.filter(
      (t) => !exported.has(t) && !PLATFORM_TABLES.includes(t),
    );
    expect(missing, 'wiped but never exported — restore loses this data').toEqual([]);
    for (const table of PLATFORM_TABLES) expect(exported.has(table), table).toBe(true);
  });
});

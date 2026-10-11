/**
 * #2528 — raw-SQL identifier and statement_timeout sinks.
 *
 * The claim under test is positional, not stylistic: a dynamic table name,
 * column name or timeout value must never be able to end its own quoting and
 * become statement syntax. Before the fix these inputs were measured against a
 * real PostgreSQL 16 (scratch instance, loopback) and each one changed the
 * statement:
 *
 *   buildUpdate key `is_super_admin" = true, "email`   -> wrote is_super_admin = true
 *                                                        even though PROTECTED had
 *                                                        filtered the literal name
 *   table name `users" ; SELECT email AS total FROM "users`
 *                                                      -> returned a second result set
 *                                                        (emails) and landed a write,
 *                                                        while rows[0] still looked like
 *                                                        a count
 *   `SET statement_timeout = '0'; UPDATE users SET is_super_admin = true; --`
 *                                                      -> the simple query protocol ran
 *                                                        the second statement
 *
 * After the fix each collapses to one identifier Postgres cannot resolve: 42703
 * / 42P01 / 22023, row untouched. Mocks cannot show that (they never parse), so
 * what is asserted here is the rendered text — the payload survives only inside
 * a quoted token, so no separator, comma or placeholder numbering can be
 * changed from outside it. The real-server half was run once against scratch
 * and is recorded in the PR.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), calls: [] as string[] }));

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    query: (sqlText: string, params?: unknown[]) => {
      mocks.calls.push(sqlText);
      return mocks.query(sqlText, params);
    },
  }),
}));

import { quoteIdentifier } from '@/lib/db/identifier';
import { buildInsert, buildUpdate, countRows } from '@/lib/db/client';
import { statementTimeoutSql } from '@/lib/db/query-timeout';
import {
  verifyAuditChainIntegrity,
  verifyReferentialIntegrity,
  verifyTenantBoundaries,
} from '@/lib/data-integrity';

/** The payload measured in #2528: closes its own quote, adds a SET assignment. */
const HOSTILE_KEY = 'is_super_admin" = true, "email';
/** Closes the quoted name and starts a second statement. */
const HOSTILE_TABLE = 'users" ; SELECT email AS total FROM "users';
/** Was interpolated raw into the timeout literal. */
const HOSTILE_TIMEOUT = "0'; UPDATE users SET is_super_admin = true WHERE id = 1; --";

/**
 * Count `needle` occurrences that sit OUTSIDE a quoted identifier, applying
 * PostgreSQL's rule that `""` inside a quoted identifier is one literal `"`.
 *
 * This is the property the fix buys: syntax that matters (statement separators,
 * SET-list commas) can only exist outside quoting, and a payload that cannot
 * close its quote cannot put anything outside it.
 */
function topLevel(sqlText: string, needle: string): number {
  let inQuote = false;
  let hits = 0;
  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    if (ch === '"') {
      if (inQuote && sqlText[i + 1] === '"') {
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === needle) hits++;
  }
  return hits;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
});

describe('quoteIdentifier', () => {
  it('doubles embedded quotes instead of letting them close the identifier', () => {
    expect(quoteIdentifier(HOSTILE_KEY)).toBe('"is_super_admin"" = true, ""email"');
  });

  it('leaves an ordinary name byte-identical', () => {
    expect(quoteIdentifier('is_super_admin')).toBe('"is_super_admin"');
    expect(quoteIdentifier('created_at')).toBe('"created_at"');
  });

  it('keeps a legitimately quoted mixed-case name usable', () => {
    // Rejecting instead of escaping would break this, and the SQL exporter has
    // to round-trip names like it.
    expect(quoteIdentifier('MixedCase')).toBe('"MixedCase"');
    expect(quoteIdentifier('x"y')).toBe('"x""y"');
  });

  it('refuses what cannot be an identifier at all', () => {
    expect(() => quoteIdentifier('')).toThrow(/non-empty string/);
    expect(() => quoteIdentifier('a\u0000b')).toThrow(/NUL/);
    expect(() => quoteIdentifier(42 as unknown as string)).toThrow(/non-empty string/);
  });
});

describe('buildUpdate / buildInsert — column names (#2528)', () => {
  it('renders a hostile SET key as one unresolvable identifier, not two assignments', () => {
    const { sql, values } = buildUpdate('users', { [HOSTILE_KEY]: 'taken-over@evil.example' }, { id: '1' });

    expect(sql).toContain('"is_super_admin"" = true, ""email"=$1');
    // The breakout turned the payload into a second, real assignment target.
    expect(sql).not.toContain('"is_super_admin" = true');
    // SET-list: exactly one top-level comma, the one before updated_at.
    expect(topLevel(sql, ',')).toBe(1);
    expect(sql).toContain('WHERE "id"=$2');
    expect(values).toEqual(['taken-over@evil.example', '1']);
  });

  it('does not let a hostile WHERE key move the parameter numbering', () => {
    const { sql, values } = buildUpdate('users', { name: 'Jane' }, { [HOSTILE_KEY]: 'x' });

    expect(sql).toContain('SET "name"=$1');
    expect(sql).toContain('WHERE "is_super_admin"" = true, ""email"=$2');
    expect(values).toEqual(['Jane', 'x']);
  });

  it('keeps the AND joiner and numbering with a hostile second predicate key', () => {
    const { sql, values } = buildUpdate('users', { name: 'Jane' }, { id: '1', [HOSTILE_KEY]: 'x' });

    expect(sql).toBe(
      'UPDATE public.users SET "name"=$1, updated_at=now() WHERE "id"=$2 ' +
        'AND "is_super_admin"" = true, ""email"=$3 RETURNING *'
    );
    expect(values).toEqual(['Jane', '1', 'x']);
  });

  it('escapes a hostile column in the INSERT column list too', () => {
    const { sql } = buildInsert('contacts', { [HOSTILE_KEY]: 'v' });

    expect(sql).toContain('("is_super_admin"" = true, ""email")');
    expect(sql).toContain('VALUES ($1)');
    expect(topLevel(sql, ',')).toBe(0);
  });

  it('keeps protected columns filtered and ordinary output unchanged', () => {
    const { sql } = buildUpdate('users', { name: 'Jane', is_super_admin: true }, { id: '123' });

    expect(sql).not.toContain('is_super_admin');
    expect(sql).toBe('UPDATE public.users SET "name"=$1, updated_at=now() WHERE "id"=$2 RETURNING *');
  });
});

describe('countRows (#2528)', () => {
  it('escapes a hostile predicate column', async () => {
    mocks.query.mockResolvedValue({ rows: [{ count: '7' }] });

    await expect(countRows('users', { [HOSTILE_KEY]: 'x' })).resolves.toBe(7);
    expect(mocks.calls[0]).toBe(
      'SELECT count(*)::int as count FROM public.users WHERE "is_super_admin"" = true, ""email"=$1'
    );
  });

  it('counts the whole table when the predicate is empty (was a 42601)', async () => {
    mocks.query.mockResolvedValue({ rows: [{ count: '12' }] });

    await expect(countRows('users', {})).resolves.toBe(12);
    expect(mocks.calls[0]).toBe('SELECT count(*)::int as count FROM public.users');
    expect(mocks.calls[0]).not.toMatch(/WHERE/);
  });

  it('still rejects a table outside the whitelist before touching the pool', async () => {
    await expect(countRows('not_a_table', { id: '1' })).rejects.toThrow('Invalid table name');
    expect(mocks.calls).toHaveLength(0);
  });
});

describe('statementTimeoutSql (#2528)', () => {
  it('emits the same text the inline sites emitted for a finite timeout', () => {
    expect(statementTimeoutSql(15_000, { local: true })).toBe("SET LOCAL statement_timeout = '15000'");
    expect(statementTimeoutSql(60_000)).toBe("SET statement_timeout = '60000'");
    expect(statementTimeoutSql(30_000, { local: true })).toBe("SET LOCAL statement_timeout = '30000'");
  });

  it('rounds and clamps to at least 1ms', () => {
    expect(statementTimeoutSql(0.4)).toBe("SET statement_timeout = '1'");
    expect(statementTimeoutSql(1500.6)).toBe("SET statement_timeout = '1501'");
  });

  it('cannot be reached by a string payload', () => {
    // Pre-fix this interpolated straight into the statement and Postgres ran
    // everything after the ';'.
    expect(() => statementTimeoutSql(HOSTILE_TIMEOUT as unknown as number)).toThrow(TypeError);
    expect(() => statementTimeoutSql(Number.NaN)).toThrow(TypeError);
    expect(() => statementTimeoutSql(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('leaves no separator outside the timeout literal', () => {
    expect(topLevel(statementTimeoutSql(15_000, { local: true }), ';')).toBe(0);
  });
});

describe('data-integrity table and column names (#2528)', () => {
  it('renders a hostile audit table name as one identifier in both queries', async () => {
    mocks.query.mockResolvedValue({ rows: [{ total: 0 }] });

    await verifyAuditChainIntegrity({ tableName: HOSTILE_TABLE });

    expect(mocks.calls).toHaveLength(2);
    for (const sqlText of mocks.calls) {
      expect(sqlText).toContain('FROM "users"" ; SELECT email AS total FROM ""users"');
      // The payload needed a second statement; every ';' is now inside quoting.
      expect(topLevel(sqlText, ';')).toBe(0);
    }
  });

  it('escapes caller-supplied relationship names', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyReferentialIntegrity([
      {
        sourceTable: 'invoices',
        sourceColumn: HOSTILE_KEY,
        targetTable: HOSTILE_TABLE,
        targetColumn: 'id',
      },
    ]);

    const sqlText = mocks.calls[0];
    expect(sqlText).toContain('FROM "invoices" s');
    expect(sqlText).toContain('LEFT JOIN "users"" ; SELECT email AS total FROM ""users" t');
    expect(sqlText).toContain('s."is_super_admin"" = true, ""email"');
    expect(topLevel(sqlText, ';')).toBe(0);
  });

  it('escapes tenant boundary check names', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyTenantBoundaries([
      { table: HOSTILE_TABLE, foreignColumn: HOSTILE_KEY, foreignTable: 'tenants' },
    ]);

    const sqlText = mocks.calls[0];
    expect(sqlText).toContain('INNER JOIN "tenants" t');
    expect(sqlText).toContain('s."is_super_admin"" = true, ""email"');
    expect(topLevel(sqlText, ';')).toBe(0);
  });
});

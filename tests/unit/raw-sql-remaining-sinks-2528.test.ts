/**
 * #2528, part two — the raw-SQL sinks the first pass left.
 *
 * PR #2567 landed `validateIdentifier()` / `validateTimeoutMs()` and converted the
 * six sites it counted (`lib/db/client.ts` builders, `verifyAuditChainIntegrity`'s
 * `--audit-table`, and the two option-level `statement_timeout` clamps). Four more
 * in the same family were still interpolating text into SQL on that merge, and none
 * of them are reachable from a request, which is exactly why they were easy to miss:
 *
 *   - `withTimeout()` — `SET LOCAL statement_timeout = '${…}'` with only
 *     `Math.round()` upstream, which renders `NaN` for a stray non-number;
 *   - `verifyReferentialIntegrity(relationships)` and
 *     `verifyTenantBoundaries(checks)` — both take the table/column names as a
 *     *function argument*, so the caller, not the catalog, decides what is quoted;
 *   - `exportAsSQL()` — writes a `psql`-able dump, so a name that breaks its own
 *     quote is an injection into the operator's restore step.
 *
 * Plus the 42601 that `countRows(table, {})` has always produced, and the CI guard
 * that stops the family from growing again. The SQL text here is asserted, not
 * executed — a mock cannot tell you whether a statement parses, and these shapes
 * were rehearsed against PostgreSQL 16 in #2567's own tests.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname!, '..', '..');

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    query: mocks.query,
    connect: () => Promise.resolve({ query: mocks.query, release: vi.fn() }),
  }),
}));

const BREAKOUT_COLUMN = `x" = '1' OR 1=1 --`;
const BREAKOUT_TABLE = 'users" ; SELECT email AS total FROM "users';
const BREAKOUT_TIMEOUT = "0'; UPDATE users SET is_super_admin = true WHERE id = 1; --";

beforeEach(() => {
  mocks.query.mockReset();
});

describe('withTimeout — the third statement_timeout site (#2528)', () => {
  it('renders clamped digits, not the caller\'s text', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');
    mocks.query.mockResolvedValue({ rows: [] });

    await withTimeout(1_500.7, async () => 'done');

    const rendered = mocks.query.mock.calls.map(c => String(c[0]));
    expect(rendered[0]).toBe('BEGIN');
    expect(rendered[1]).toBe("SET LOCAL statement_timeout = '1501'");
    expect(rendered).toContain('COMMIT');
  });

  it('rejects a timeout carrying text before touching the connection', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(
      withTimeout(BREAKOUT_TIMEOUT as unknown as number, async () => 'never'),
    ).rejects.toThrow(/not a number/);
    expect(mocks.query).not.toHaveBeenCalled();

    // The old code reached for Math.round(), which answers `NaN` rather than
    // throwing — and `SET LOCAL statement_timeout = 'NaN'` is a Postgres error
    // mid-transaction instead of a loud one at the route.
    await expect(
      withTimeout(undefined as unknown as number, async () => 'never'),
    ).rejects.toThrow(/not a number/);
  });
});

describe('countRows with no filter (#2528)', () => {
  it('does not emit a trailing WHERE', async () => {
    const { countRows } = await import('@/lib/db/client');
    mocks.query.mockResolvedValue({ rows: [{ count: '42' }] });

    await expect(countRows('contacts', {})).resolves.toBe(42);
    expect(mocks.query.mock.calls[0][0]).toBe('SELECT count(*)::int as count FROM public.contacts');
    expect(mocks.query.mock.calls[0][1]).toEqual([]);
  });

  it('still filters when given keys', async () => {
    const { countRows } = await import('@/lib/db/client');
    mocks.query.mockResolvedValue({ rows: [{ count: '3' }] });

    await countRows('contacts', { tenant_id: 't-1', email: 'a@b.c' });

    expect(mocks.query.mock.calls[0][0]).toBe(
      'SELECT count(*)::int as count FROM public.contacts WHERE "tenant_id"=$1 AND "email"=$2',
    );
    expect(mocks.query.mock.calls[0][1]).toEqual(['t-1', 'a@b.c']);
  });
});

describe('verifyReferentialIntegrity / verifyTenantBoundaries argument trust (#2528)', () => {
  const cleanRows = { rows: [] };

  it('reports a hostile relationship instead of running it', async () => {
    const { verifyReferentialIntegrity } = await import('@/lib/data-integrity');
    mocks.query.mockResolvedValue(cleanRows);

    const result = await verifyReferentialIntegrity([
      {
        sourceTable: BREAKOUT_TABLE,
        sourceColumn: 'quote_id',
        targetTable: 'quotes',
        targetColumn: 'id',
      },
      {
        sourceTable: 'invoices',
        sourceColumn: BREAKOUT_COLUMN,
        targetTable: 'quotes',
        targetColumn: 'id',
      },
    ]);

    expect(result.checked).toBe(2);
    expect(result.errors).toHaveLength(2);
    for (const err of result.errors) expect(err).toMatch(/bare Postgres identifier/);
    // Nothing was counted either: both failures happen before the statement renders.
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('renders the names it accepts quoted into the same statement', async () => {
    const { verifyReferentialIntegrity } = await import('@/lib/data-integrity');
    mocks.query.mockResolvedValue(cleanRows);

    await verifyReferentialIntegrity([
      {
        sourceTable: 'invoices',
        sourceColumn: 'quote_id',
        targetTable: 'quotes',
        targetColumn: 'id',
      },
    ]);

    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain('FROM "invoices" s');
    expect(sql).toContain('LEFT JOIN "quotes" t ON s."quote_id" = t."id"');
  });

  it('reports a hostile boundary check, and renders a valid one', async () => {
    const { verifyTenantBoundaries } = await import('@/lib/data-integrity');
    mocks.query.mockResolvedValue(cleanRows);

    const result = await verifyTenantBoundaries([
      { table: BREAKOUT_TABLE, foreignTable: 'tenants', foreignColumn: 'owner_id' },
      { table: 'deals', foreignTable: 'stage_history', foreignColumn: 'stage_id' },
    ]);

    expect(result.checked).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/bare Postgres identifier/);
    expect(String(mocks.query.mock.calls[0][0])).toContain('FROM "deals" s');
    expect(String(mocks.query.mock.calls[0][0])).toContain(
      'INNER JOIN "stage_history" t ON s."stage_id" = t."id"',
    );
  });

  it('accepts a declared foreignTargetColumn and rejects a hostile one', async () => {
    const { verifyTenantBoundaries } = await import('@/lib/data-integrity');
    mocks.query.mockResolvedValue(cleanRows);

    await verifyTenantBoundaries([
      {
        table: 'deals',
        foreignTable: 'stage_history',
        foreignColumn: 'stage_id',
        foreignTargetColumn: 'history_id',
      },
    ]);
    expect(String(mocks.query.mock.calls[0][0])).toContain('= t."history_id"');

    const bad = await verifyTenantBoundaries([
      {
        table: 'deals',
        foreignTable: 'stage_history',
        foreignColumn: 'stage_id',
        foreignTargetColumn: BREAKOUT_COLUMN,
      },
    ]);
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toMatch(/bare Postgres identifier/);
  });
});

describe('exportAsSQL writes a script another person runs (#2528)', () => {
  async function dumpOf(tables: Record<string, Record<string, unknown>[]>) {
    // `exportAll` is the DB read; the SQL writer only consumes its result, so the
    // writer is what is under test here.
    const { TenantDataExporter } = await import('@/lib/tenant-data-export');
    const exporter = new TenantDataExporter('tenant-1');
    exporter.exportAll = async () => ({
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [
          name,
          { columns: Object.keys(rows[0] ?? {}), rows },
        ]),
      ),
      dataSize: 1,
      tableCount: Object.keys(tables).length,
      totalRecords: 1,
      exportedAt: '2026-10-11T00:00:00.000Z',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
    });
    return exporter.exportAsSQL();
  }

  it('quotes the names it accepts', async () => {
    const sql = await dumpOf({
      contacts: [{ id: 'c-1', tenant_id: 'tenant-1', name: "O'Neil" }],
    });

    expect(sql).toContain('INSERT INTO "contacts" ("id", "tenant_id", "name")');
    expect(sql).toContain("'O''Neil'");
  });

  it('refuses a column name that could close its own quote', async () => {
    await expect(dumpOf({ contacts: [{ [BREAKOUT_COLUMN]: '1' }] })).rejects.toThrow(
      /bare Postgres identifier/,
    );
  });

  it('refuses a table name shaped as a second statement', async () => {
    await expect(dumpOf({ [BREAKOUT_TABLE]: [{ id: 'x-1' }] })).rejects.toThrow(
      /bare Postgres identifier/,
    );
  });
});

describe('guard:raw-sql catches the next one (#2528)', () => {
  // A guard that silently stops matching is worse than no guard, because the
  // register cites it as evidence. So the guard is run against a throwaway tree in
  // both directions: the pattern it exists for must fail, and marking it must pass.
  const dir = mkdtempSync(join(tmpdir(), 'rawsql-guard-'));
  const write = (relPath: string, body: string) => {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return full;
  };
  const run = () =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-raw-sql-sinks.mjs')], {
      cwd: dir,
      encoding: 'utf8',
    });

  const SINK = '  const q = `SELECT * FROM public.users WHERE "${name}" = $1`;\n';

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails on an unmarked interpolated identifier', () => {
    rmSync(join(dir, 'lib'), { recursive: true, force: true });
    write('lib/planted.ts', `export function f(name: string) {\n${SINK}}\n`);

    const out = run();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('lib/planted.ts:2');
  });

  it('accepts the same line once it calls validateIdentifier, and once marked', () => {
    rmSync(join(dir, 'lib'), { recursive: true, force: true });
    write(
      'lib/guarded.ts',
      'export function f(name: string) {\n' +
        '  return `SELECT * FROM public.users WHERE "${validateIdentifier(name)}" = $1`;\n' +
        '}\n',
    );
    expect(run().status).toBe(0);

    rmSync(join(dir, 'lib'), { recursive: true, force: true });
    write(
      'lib/marked.ts',
      'export function f(name: string) {\n' +
        '  const q = `SELECT * FROM public.users WHERE "${name}" = $1`; // raw-sql-guard: allow — reasoned\n' +
        '}\n',
    );
    expect(run().status).toBe(0);
  });

  it('refuses an allow region that never closes', () => {
    rmSync(join(dir, 'lib'), { recursive: true, force: true });
    write(
      'lib/loose.ts',
      '// raw-sql-guard: begin allow — oops\n' +
        'export function f(name: string) {\n' +
        '  return `SELECT * FROM public.users WHERE "${name}" = $1`;\n' +
        '}\n',
    );

    const out = run();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('unbalanced');
  });

  it('finds an unclamped statement_timeout even in the module that used to own the builder', () => {
    rmSync(join(dir, 'lib'), { recursive: true, force: true });
    write(
      'lib/db/query-timeout.ts',
      'export async function q(client: { query: (s: string) => Promise<unknown> }, timeoutMs: number) {\n' +
        "  await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);\n" +
        '}\n',
    );

    const out = run();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('lib/db/query-timeout.ts:2');
  });

  it('passes on this repository as committed', () => {
    const out = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-raw-sql-sinks.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('0 unescaped raw-SQL sinks');
  });
});

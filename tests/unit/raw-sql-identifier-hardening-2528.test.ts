/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2528 — six raw-string sinks interpolated a caller-supplied *name* or *number*
 * and none of them escaped it. Table names were already allowlisted and values
 * already went through `$n` binding, which is why the issue is hardening rather
 * than an active injection: no request param reaches these today. But an
 * identifier position can never be parameterised and `SET` has no parameter slot
 * at all, so the only fix is to constrain the shape before interpolation.
 *
 * The load-bearing line is that quoting is not escaping: a key of
 * `x" = '1' OR 1=1 --` closes its own quoted identifier and continues the
 * statement. These tests pin that breakout attempt at every one of the six
 * sinks, plus the positive cases so a future fix that rejects every identifier
 * does not pass silently.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const BREAKOUT = 'x" = \'1\' OR 1=1 --';
const dialect = new PgDialect({} as never);

const mockPoolQuery = vi.fn();
vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    query: mockPoolQuery,
    connect: () => Promise.resolve({ query: mockPoolQuery, release: vi.fn() }),
  }),
}));

describe('validateIdentifier — the shape that is safe to quote (#2528)', () => {
  it('accepts the bare snake_case names this codebase actually uses', async () => {
    const { validateIdentifier, BARE_IDENTIFIER } = await import('@/lib/sql-allowlist');
    for (const name of ['tenant_id', 'contact_id', 'deleted_at', 'portal_token', 'a']) {
      expect(validateIdentifier(name)).toBe(name);
    }
    expect(BARE_IDENTIFIER.test('audit_logs')).toBe(true);
  });

  it('rejects the breakout key, and everything that is not a bare identifier', async () => {
    const { validateIdentifier } = await import('@/lib/sql-allowlist');
    const rejected = [BREAKOUT, 'a"b', 'a b', 'a;b', "a'b", 'a-b', 'A', '', 'a.b', '_'.repeat(64)];
    for (const bad of rejected) {
      expect(
        () => validateIdentifier(bad),
        `${JSON.stringify(bad)} must not reach a raw SQL`,
      ).toThrow(/bare Postgres identifier/);
    }
  });
});

describe('lib/db/client builders (#2528)', () => {
  it('buildInsert refuses a hostile column key before rendering SQL', async () => {
    const { buildInsert } = await import('@/lib/db/client');
    expect(() => buildInsert('contacts', { [BREAKOUT]: '1' })).toThrow(/bare Postgres identifier/);
    expect(() => buildInsert('contacts', { name: 'ok', [BREAKOUT]: 'x' })).toThrow();
  });

  it('buildInsert still renders a legitimate object', async () => {
    const { buildInsert } = await import('@/lib/db/client');
    // `created_at` is protected, so only the two real keys survive.
    const out = buildInsert('contacts', { name: 'Asha', tenant_id: 't-1', created_at: 'ignored' });
    expect(out.sql).toBe(
      'INSERT INTO public.contacts ("name","tenant_id") VALUES ($1,$2) RETURNING *',
    );
    expect(out.values).toEqual(['Asha', 't-1']);
  });

  it('buildUpdate refuses hostile keys in both the SET and the WHERE object', async () => {
    const { buildUpdate } = await import('@/lib/db/client');
    expect(() => buildUpdate('contacts', { [BREAKOUT]: '1' }, { id: 'c-1' })).toThrow(
      /bare Postgres identifier/,
    );
    // The where-clause keys are a separate list — both paths interpolate.
    expect(() => buildUpdate('contacts', { name: 'x' }, { [BREAKOUT]: '1' })).toThrow(
      /bare Postgres identifier/,
    );
    const ok = buildUpdate('contacts', { name: 'Asha' }, { id: 'c-1' });
    expect(ok.sql).toBe(
      'UPDATE public.contacts SET "name"=$1, updated_at=now() WHERE "id"=$2 RETURNING *',
    );
    expect(ok.values).toEqual(['Asha', 'c-1']);
  });

  it('countRows rejects a hostile key without querying', async () => {
    const { countRows } = await import('@/lib/db/client');
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ count: '3' }] });
    await expect(countRows('contacts', { [BREAKOUT]: '1' })).rejects.toThrow(
      /bare Postgres identifier/,
    );
    expect(mockPoolQuery).not.toHaveBeenCalled();
    await expect(countRows('contacts', { tenant_id: 't-1' })).resolves.toBe(3);
    expect(mockPoolQuery.mock.calls[0][0]).toBe(
      'SELECT count(*)::int as count FROM public.contacts WHERE "tenant_id"=$1',
    );
    expect(mockPoolQuery.mock.calls[0][1]).toEqual(['t-1']);
  });
});

describe('validateTimeoutMs — digits only (#2528)', () => {
  it('coerces to a positive integer with no exponents', async () => {
    const { validateTimeoutMs, MAX_STATEMENT_TIMEOUT_MS } = await import('@/lib/sql-allowlist');
    const cases: [unknown, number][] = [
      [15_000, 15_000],
      [2_500.4, 2_500],
      [0, 1],
      [-100, 1],
      ['500', 500],
      // 1e21 is finite and would otherwise render as the text "1e+21".
      [1e21, MAX_STATEMENT_TIMEOUT_MS],
    ];
    for (const [input, expected] of cases) {
      const out = validateTimeoutMs(input as number);
      expect(out).toBe(expected);
      expect(String(out)).toMatch(/^\d+$/);
    }
  });

  it('throws on anything that is not a number, instead of interpolating it', async () => {
    const { validateTimeoutMs } = await import('@/lib/sql-allowlist');
    const rejected: unknown[] = [
      BREAKOUT,
      '1; DROP TABLE users--',
      '',
      '   ',
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
      {},
      true,
    ];
    for (const bad of rejected) {
      expect(() => validateTimeoutMs(bad as unknown as number), String(bad)).toThrow(
        /statement timeout/,
      );
    }
  });
});

describe('withTransaction — SET LOCAL statement_timeout (#2528)', () => {
  async function runWith(timeoutMs: unknown): Promise<string> {
    const captured: unknown[] = [];
    const tx = {
      execute: (q: unknown) => {
        captured.push(q);
        return Promise.resolve({ rows: [] });
      },
    };
    const dbClient = {
      transaction: (fn: (t: unknown) => Promise<NextResponse>) => fn(tx),
    } as never;
    const { withTransaction } = await import('@/lib/api/with-transaction');
    await withTransaction(dbClient, async () => NextResponse.json({ ok: true }), {
      timeoutMs: timeoutMs as number,
    });
    const rendered = dialect.sqlToQuery(captured[0] as never);
    expect(rendered.sql).toMatch(/^SET LOCAL statement_timeout = /);
    return rendered.sql;
  }

  it('renders a rounded timeout, not whatever text was passed in', async () => {
    expect(await runWith(2_500.4)).toBe(`SET LOCAL statement_timeout = '2500'`);
    expect(await runWith('5000')).toBe(`SET LOCAL statement_timeout = '5000'`);
  });

  it('throws before the transaction opens when the option is not a number', async () => {
    const { withTransaction } = await import('@/lib/api/with-transaction');
    const dbClient = { transaction: vi.fn() } as never;
    await expect(
      withTransaction(dbClient, async () => NextResponse.json({ ok: true }), {
        timeoutMs: BREAKOUT as unknown as number,
      }),
    ).rejects.toThrow(/statement timeout/);
    expect(dbClient.transaction).not.toHaveBeenCalled();
  });
});

describe('withCronLock — SET statement_timeout (#2528)', () => {
  it('interpolates a clamped integer and never the raw option', async () => {
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ acquired: true }] });
    const { withCronLock } = await import('@/lib/cron/distributed-lock');
    const res = await withCronLock('nightly-job', async () => NextResponse.json({ ok: true }), {
      timeoutMs: '30000.7',
    });

    expect(res.status).toBe(200);
    const setStatement = mockPoolQuery.mock.calls[0][0] as string;
    expect(setStatement).toBe(`SET statement_timeout = '30001'`);
    expect(setStatement).toMatch(/^SET statement_timeout = '\d+'$/);
  });

  it('throws before connecting when the option carries text', async () => {
    mockPoolQuery.mockReset();
    const { withCronLock } = await import('@/lib/cron/distributed-lock');
    await expect(
      withCronLock('nightly-job', async () => NextResponse.json({ ok: true }), {
        timeoutMs: `1'; DROP TABLE users; --` as unknown as number,
      }),
    ).rejects.toThrow(/statement timeout/);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});

describe('verifyAuditChainIntegrity — operator-supplied --audit-table (#2528)', () => {
  it('rejects a quoted-out table name before any query runs', async () => {
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ total: 0 }] });
    const { verifyAuditChainIntegrity } = await import('@/lib/data-integrity');
    await expect(
      verifyAuditChainIntegrity({ tableName: `audit_logs" WHERE 1=1; --` }),
    ).rejects.toThrow(/bare Postgres identifier/);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('still walks the table it is given', async () => {
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ total: 0 }] });
    const { verifyAuditChainIntegrity } = await import('@/lib/data-integrity');
    const res = await verifyAuditChainIntegrity({ tableName: 'super_admin_audit_logs' });

    expect(res.errors).toEqual([]);
    expect(mockPoolQuery.mock.calls[0][0]).toBe(
      'SELECT COUNT(*)::int AS total FROM "super_admin_audit_logs"',
    );
  });
});

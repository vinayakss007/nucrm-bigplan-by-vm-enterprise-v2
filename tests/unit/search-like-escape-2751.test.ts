/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2751 — three search boxes handed the user's own `%` and `_` to Postgres as
 * wildcards.
 *
 * `lib/api/sanitize-like.ts` exists for this and names the failure in its own
 * docstring ("`q=_%` matches every non-empty value"). It is applied at ten-plus
 * sites, including the admin twin of the same panel
 * (`app/api/superadmin/data-explorer/route.ts:224`), and `search/advanced/route.ts:26`
 * keeps a private escape for the same three characters. These three were missed
 * by the sweep in #1135 / #1334 / #1335, which each fixed a short list of files
 * rather than the class:
 *
 * | site (on `main`, before this fix) | line | pattern |
 * | --- | --- | --- |
 * | `app/api/tenant/data-explorer/route.ts` free text | `:108` | `` `%${q}%` `` |
 * | `app/api/tenant/data-explorer/route.ts` column filter | `:115` | `` `%${fieldValue}%` `` |
 * | `app/api/super-admin/audit-logs/route.ts` search | `:108` | `` `%${search}%` `` |
 *
 * The value is a bound parameter, so nothing is injectable — the defect is the
 * *result set*. `q=%` in Data Explorer matched every non-null value of every
 * search field, so the box looked like it filtered nothing while the rows on
 * screen were the whole (owner-scoped, #2704) set; and a term that really
 * contains `_` — SKU `WIDGET_9`, action `contact_view` — quietly matched
 * `WIDGETX9` / `contactXview`, which in a panel that inline-edits the row it
 * shows means editing the wrong record.
 *
 * The assertions are on the **bound parameter**, not the SQL text: the rendered
 * statement is identical either way, and only the value records whether the
 * escape happened. `db.execute` answers by reading what the route actually sent,
 * so a route that never escapes cannot pass these.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

let calls: { sql: string; params: unknown[] }[];

/** Every `%…%` value the route handed to an ILIKE — the pattern parameters. */
function ilikeParams(sqlText: string, params: unknown[]): string[] {
  const out: string[] = [];
  const re = /ILIKE \$(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) {
    const v = params[Number(m[1]) - 1];
    if (typeof v === 'string') out.push(v);
  }
  return out;
}

const mockDb: Record<string, unknown> = {
  execute: vi.fn(),
  select: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/audit/super-admin', () => ({ verifySuperAdminAuditChain: async () => ({ ok: true }) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const explorer = await import('@/app/api/tenant/data-explorer/route');
const auditLogs = await import('@/app/api/super-admin/audit-logs/route');

function ctx(permissions: Record<string, boolean>, isSuperAdmin = false): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: isSuperAdmin ? 'superadmin' : 'rep',
    permissions, isAdmin: false, isSuperAdmin,
  } as unknown as AuthContext;
}

const REP = { 'contacts.edit': true, 'leads.edit': true };

beforeEach(() => {
  calls = [];
  mockDb.execute = vi.fn((query: unknown) => {
    const q = dialect.sqlToQuery(query as never);
    const rendered = { sql: q.sql, params: q.params as unknown[] };
    calls.push(rendered);
    const text = rendered.sql.trim();
    return Promise.resolve({
      rows: /^SELECT count\(\*\)/i.test(text) ? [{ count: '0' }] : [],
    });
  });
  mockDb.select = vi.fn((fields?: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'orderBy', 'limit', 'offset']) builder[m] = () => builder;
    builder['where'] = (predicate: unknown) => {
      if (predicate) {
        const q = dialect.sqlToQuery(predicate as never);
        calls.push({ sql: q.sql, params: q.params as unknown[] });
      }
      return builder;
    };
    builder['then'] = (resolve: (v: unknown[]) => unknown) =>
      resolve(fields ? [{ total: 0 }] : []);
    return builder;
  });
});

async function explore(params: Record<string, string>, c = ctx(REP)) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(c);
  const url = new URL('http://localhost:3000/api/tenant/data-explorer');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url, { method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' } });
  return (explorer.GET as (r: NextRequest) => Promise<Response>)(req);
}

async function searchAudit(search: string) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx({}, true));
  const url = new URL('http://localhost:3000/api/super-admin/audit-logs');
  url.searchParams.set('search', search);
  const req = new NextRequest(url, { method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' } });
  return (auditLogs.GET as (r: NextRequest) => Promise<Response>)(req);
}

describe('Data Explorer escapes the metacharacters in the user\'s term (#2751)', () => {
  it('binds an escaped pattern for a term containing a percent sign', async () => {
    const res = await explore({ type: 'contacts', q: '50%' });
    expect(res.status, await res.text()).toBe(200);
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) expect(p).toBe('%50\\%%');
  });

  it('binds an escaped pattern for a term containing an underscore', async () => {
    await explore({ type: 'contacts', q: 'WIDGET_9' });
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%WIDGET\\_9%')).toBe(true);
  });

  it('escapes a literal backslash before anything else, so it cannot eat the escapes', async () => {
    await explore({ type: 'contacts', q: 'a\\%b' });
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%a\\\\\\%b%')).toBe(true);
  });

  it('leaves an ordinary term alone — escaping is not a rewrite', async () => {
    await explore({ type: 'contacts', q: 'acme' });
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%acme%')).toBe(true);
  });

  it('the count query and the data query get the same escaped pattern', async () => {
    await explore({ type: 'deals', q: '50%' });
    const counts = calls.filter((c) => /^SELECT count\(\*\)/i.test(c.sql.trim()));
    const data = calls.filter((c) => !/^SELECT count\(\*\)/i.test(c.sql.trim()));
    expect(counts).toHaveLength(1);
    expect(data).toHaveLength(1);
    for (const c of [...counts, ...data]) {
      const patterns = ilikeParams(c.sql, c.params);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.every((p) => p === '%50\\%%')).toBe(true);
    }
  });

  it('escapes the column filter too, not only the free-text box', async () => {
    await explore({ type: 'contacts', field: 'email', value: 'a%b' });
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns).toContain('%a\\%b%');
  });

  it('escapes for a caller whose read is owner-narrowed as well as a view_all holder', async () => {
    await explore({ type: 'contacts', q: '_' }, ctx(REP));
    const repPatterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(repPatterns.length).toBeGreaterThan(0);
    expect(repPatterns.every((p) => p === '%\\_%')).toBe(true);
    expect(calls.some((c) => /assigned_to/i.test(c.sql))).toBe(true);

    calls = [];
    await explore({ type: 'contacts', q: '_' }, ctx({ 'contacts.view_all': true, ...REP }));
    const managerPatterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(managerPatterns.every((p) => p === '%\\_%')).toBe(true);
  });

  it('still matches nothing when the term is a lone percent, rather than everything', async () => {
    await explore({ type: 'leads', q: '%' });
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%\\%%')).toBe(true);
    expect(patterns.some((p) => p === '%%%')).toBe(false);
  });
});

describe('the platform audit trail search escapes the user\'s wildcards (#2751)', () => {
  it('binds an escaped pattern for an action name containing an underscore', async () => {
    const res = await searchAudit('contact_view');
    expect(res.status, await res.text()).toBe(200);
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    // Four fields per statement, and the route runs the list query and the count
    // query with the same predicate.
    expect(patterns.length).toBeGreaterThanOrEqual(4);
    expect(patterns.every((p) => p === '%contact\\_view%')).toBe(true);
  });

  it('does not turn a lone percent into a match-everything pattern', async () => {
    await searchAudit('%');
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%\\%%')).toBe(true);
  });

  it('leaves an ordinary search term as it was typed', async () => {
    await searchAudit('export');
    const patterns = calls.flatMap((c) => ilikeParams(c.sql, c.params));
    expect(patterns.every((p) => p === '%export%')).toBe(true);
  });
});

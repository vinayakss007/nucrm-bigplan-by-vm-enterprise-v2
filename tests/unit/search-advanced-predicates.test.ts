/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// The route builds its predicates and hands them to drizzle; this renders those
// predicates to real SQL and asserts on the text, because every defect here was
// "Postgres rejects what we sent".
vi.mock('@/drizzle/db', () => ({ db: { select: () => chain() } }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: TENANT, userId: 'user-1', email: 'a@b.c' }),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';

let body: Record<string, unknown> = {};
vi.mock('@/lib/api/validate', () => ({ readJsonBody: async () => body }));

const dialect = new PgDialect();
let wheres: unknown[] = [];
let lastStatus = 0;

type QueryChain = {
  from: () => QueryChain;
  where: (w: unknown) => QueryChain;
  orderBy: () => QueryChain;
  groupBy: () => QueryChain;
  limit: () => QueryChain;
  offset: () => QueryChain;
  then: (res: (v: unknown[]) => unknown) => unknown;
};

function chain(): QueryChain {
  const self: QueryChain = {
    from: () => self,
    where: (w: unknown) => { wheres.push(w); return self; },
    orderBy: () => self,
    groupBy: () => self,
    limit: () => self,
    offset: () => self,
    then: (res: (v: unknown[]) => unknown) => res([]),
  };
  return self;
}

const POST = await importThenPost();
async function importThenPost() {
  const mod = await import('@/app/api/tenant/search/advanced/route');
  return mod.POST as (req: Request) => Promise<Response>;
}

async function run(payload: Record<string, unknown>) {
  wheres = [];
  body = payload;
  const res = await POST(new Request('http://x/api/tenant/search/advanced', { method: 'POST' }));
  lastStatus = res.status;
  return res;
}

function sqlText(): string {
  return wheres.map((w) => dialect.sqlToQuery(w as never).sql).join('\n');
}

function params(): unknown[] {
  return wheres.flatMap((w) => dialect.sqlToQuery(w as never).params as unknown[]);
}

beforeEach(() => { wheres = []; body = {}; });

describe('advanced search predicates', () => {
  it('sends no ESCAPE clause, which is what made every text search throw', async () => {
    await run({ type: 'contacts', query: 'acme' });
    expect(lastStatus).toBe(200);
    const built = sqlText();
    // standard_conforming_strings is on, so the `ESCAPE '\\'` this route used to
    // append is a two-character string and Postgres answered 22019.
    expect(built).not.toMatch(/escape/i);
    expect(built).toMatch(/ilike/i);
  });

  it('escapes the wildcards a user types instead of letting them widen the search', async () => {
    await run({ type: 'contacts', query: '50%_a\\b' });
    const like = params().find((p) => typeof p === 'string' && p.startsWith('%')) as string;
    expect(like).toBe('%50\\%\\_a\\\\b%');
  });

  it('resolves deal stage names through deal_stages rather than the uuid column', async () => {
    await run({ type: 'deals', filters: { stage: ['won', 'Lost'] } });
    const built = sqlText();
    expect(built).toMatch(/"deals"\."stage_id" in/);
    expect(built).toMatch(/lower\(ds\.name\)/);
    expect(built).toMatch(/deal_stages/);
    // Binding 'won' straight to deals.stage_id is what raised 22P02.
    expect(params()).toContain('won');
    expect(params()).toContain('lost');
  });

  it('filters contacts by source, which was collected and then discarded', async () => {
    await run({ type: 'contacts', filters: { source: ['referral'] } });
    expect(sqlText()).toMatch(/lead_source/);
    expect(params()).toContain('referral');
  });

  it('searches leads instead of rejecting the type the picker offers', async () => {
    await run({ type: 'leads', query: 'flow' });
    expect(lastStatus).toBe(200);
    expect(sqlText()).toMatch(/"leads"\."tenant_id"/);
  });

  it('still rejects a type that is not a table', async () => {
    await run({ type: 'invoices' });
    expect(lastStatus).toBe(400);
  });
});

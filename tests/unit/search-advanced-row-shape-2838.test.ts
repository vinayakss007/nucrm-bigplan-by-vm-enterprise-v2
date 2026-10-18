/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2838 — the two fields the filtered rows would have rendered wrong.
 *
 * Wiring the advanced response to the screen is only honest if the response
 * means what the row markup assumes. It did not: the deals branch answered the
 * `stage` the search page prints in its stage chip with `deals.stage_id`, a
 * uuid, while the typeahead route (`app/api/tenant/search/route.ts:120`) joins
 * `dealStages.name` into that same field; and the companies branch returned no
 * `contact_count` at all, which the page prints unguarded as
 * "{n} contacts" (`app/api/tenant/search/route.ts:153` computes it).
 *
 * So this file pins the shape, not the predicates — those are
 * `search-advanced-predicates.test.ts` and `advanced-search-scope-2690.test.ts`.
 * It asserts what each branch *selects* and what it puts in the body, because a
 * stubbed row alone would pass even with the join missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  rows: [] as Record<string, unknown>[],
  selects: [] as Record<string, unknown>[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (shape: Record<string, unknown>) => {
      state.selects.push(shape);
      const chain: unknown = {
        from: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (res: (v: Record<string, unknown>[]) => unknown) => res(state.rows),
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/api/validate', () => ({ readJsonBody: async () => state.body }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: async () => ({
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
      email: 'a@b.c',
      roleSlug: 'manager',
      permissions: {
        'contacts.view_all': true, 'deals.view_all': true,
        'tasks.view_all': true, 'leads.view_all': true,
      },
    }),
  };
});

const POST = (await import('@/app/api/tenant/search/advanced/route'))
  .POST as (req: Request) => Promise<Response>;

const dialect = new PgDialect();
const STAGE_ID = '22222222-2222-2222-2222-222222222222';

function sqlOf(field: unknown): string {
  // A selected field is either a column or an `sql` template; wrapping both the
  // same way keeps the assertions about *which* field was selected honest.
  return dialect.sqlToQuery(sql`${field}` as never).sql.replace(/"/g, '');
}

async function run(payload: Record<string, unknown>, rows: Record<string, unknown>[]) {
  state.body = payload;
  state.rows = rows;
  state.selects = [];
  const res = await POST(new Request('http://x/api/tenant/search/advanced', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
  return res.json() as Promise<{ data: Record<string, unknown>[]; pagination: Record<string, unknown> }>;
}

beforeEach(() => {
  state.selects = [];
  state.rows = [];
});

describe('#2838 — the advanced response means what the row markup prints', () => {
  it('answers a deal’s stage with the stage name, not its id', async () => {
    const json = await run(
      { type: 'deals', filters: {} },
      [{
        id: 'deal-1',
        title: 'Annual renewal',
        amount: '900',
        stageId: STAGE_ID,
        stageName: 'Negotiation',
        metadata: null,
        closeDate: null,
        createdAt: null,
        count: 3,
      }],
    );

    expect(json.data[0].stage).toBe('Negotiation');
    expect(JSON.stringify(json.data)).not.toContain(STAGE_ID);

    // The row had to be joined to be selected: without the leftJoin there is no
    // `stageName` field in the select at all.
    const shape = state.selects.find((s) => 'stageName' in s);
    expect(shape, 'the deals branch selects a stage name').toBeDefined();
    expect(sqlOf(shape!.stageName)).toMatch(/deal_stages\.name/i);
  });

  it('gives a company row the contact count the page prints', async () => {
    const json = await run(
      { type: 'companies', filters: {} },
      [{
        id: 'co-1', name: 'Acme', domain: 'acme.test', industry: 'technology',
        size: null, contact_count: 7, createdAt: null, count: 1,
      }],
    );

    expect(json.data[0].contact_count).toBe(7);
    expect(String(json.data[0].contact_count)).not.toBe('undefined');

    const shape = state.selects.find((s) => 'contact_count' in s);
    expect(shape, 'the companies branch counts contacts').toBeDefined();
    expect(sqlOf(shape!.contact_count)).toMatch(/count\(\*\)::int/i);
    expect(sqlOf(shape!.contact_count)).toMatch(/is null/i);
  });

  it('reports the total the route counted alongside the page it returned', async () => {
    const json = await run(
      { type: 'contacts', filters: { status: ['qualified'] }, page: 2, limit: 25 },
      // Drizzle hands back the select's own aliases; the route renames them to
      // snake_case on the way out.
      [{ id: 'c-1', firstName: 'Ada', lastName: 'Lovelace', email: null, phone: null, leadStatus: 'qualified', leadSource: 'web', companyId: null, createdAt: null, count: 138 }],
    );

    expect(json.pagination).toMatchObject({ total: 138, page: 2, limit: 25, hasMore: true });
    expect(json.data[0]).toMatchObject({ id: 'c-1', first_name: 'Ada', lead_status: 'qualified' });
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3177 — the portal half of `quotes.status` still force-wrote from any state.
 *
 * #3159 guarded the seller's writers (`tenant/offers/*`, `public/offers/*`) by
 * folding each transition's from-set into the `UPDATE … WHERE` and reading the
 * claim back with `.returning()`. The routes a customer actually clicks —
 * `public/quotes/[id]/accept` and `…/decline` — were left doing the older three
 * steps: read the row, check it against a local copy of the from-set
 * (`const validStatuses = ['sent','viewed']`, a hand-copy of
 * `OFFER_TRANSITIONS.accepted`), then write keyed on the id alone.
 *
 * Postgres re-evaluates the WHERE under the row lock, so the guard was free and
 * unclaimed, and the last commit won the column whatever it had been checking:
 *
 *   seller cancels, commits, buyer's in-flight accept lands second
 *     →  `cancelled` becomes `accepted`, with an `offer_accepted` activity row
 *        and an audit entry asserting the customer accepted a closed quote;
 *   the expiry arm lands after an accept → `accepted` becomes `expired`;
 *   two accept tabs → `acceptedAt` restamped, activity row inserted twice.
 *
 * So this suite asserts both halves, the way #3159's does: the SQL each guarded
 * write renders (through `PgDialect`, no database), and what the handler does
 * when that write matches zero rows — the race itself, and the only part a
 * mocked `db` can replay. A `[{id}]` stub passes with no status predicate
 * anywhere, and a WHERE nobody checks the emptiness of still answers 200.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const QUOTE = '55555555-5555-4555-8555-555555555555';
const CONTACT = '66666666-6666-4666-8666-666666666666';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  quote: null as Record<string, unknown> | null,
  /** Rows the status re-read after a lost claim returns. */
  fresh: [] as { status: string }[],
  /** `.returning()` rows for each guarded UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  inserted: [] as { table: string; values: Record<string, unknown> }[],
  audits: [] as Record<string, unknown>[],
  /** SELECTs issued inside the current transaction. */
  selects: 0,
};

const tx: Record<string, unknown> = {
  update: (table: unknown) => {
    // `.set()` runs before `.where()`, so both halves are collected and the
    // statement is recorded only once the handler consumes it — `.returning()`
    // (a guarded claim) or a bare `await` (an update whose result is ignored).
    let rec: Captured = { sql: '', params: [], set: {} };
    const commit = (): void => {
      void getTableName(table as never);
      state.updates.push(rec);
    };
    const node: Record<string, unknown> = {
      set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
      where: (pred: unknown) => {
        const rendered = dialect.sqlToQuery(pred as never);
        rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
        return node;
      },
      returning: () => {
        const at = state.updates.length;
        commit();
        return Promise.resolve(state.updateReturns[at] ?? []);
      },
      then: (resolve: (v: unknown) => unknown) => {
        const at = state.updates.length;
        commit();
        return Promise.resolve(state.updateReturns[at] ?? []).then(resolve);
      },
    };
    return node;
  },
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      state.inserted.push({ table: getTableName(table as never), values });
      return Promise.resolve();
    },
  }),
  // The quote read is the first SELECT in the transaction and the committed
  // status re-read is any later one; a lost claim is exactly that second case.
  select: () => {
    const picks = state.selects++;
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit']) builder[method] = () => builder;
    builder['then'] = (resolve: (v: unknown) => unknown) => {
      const rows = picks === 0 ? (state.quote ? [state.quote] : []) : state.fresh;
      return Promise.resolve(rows).then(resolve);
    };
    return builder;
  },
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: { quotes: { findFirst: async () => state.quote } },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
  // The real helper opens a tenant-scoped transaction; the harness hands back
  // the same recording tx, so `withTenantContext` cannot be what hides a bug.
  withTenantContext: async (_tid: string, _u: string, cb: (t: unknown) => Promise<unknown>) => {
    state.selects = 0; // the next SELECT the handler runs is its first
    return cb(tx);
  },
}));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: async () => ({ email: 'buyer@example.test', tenantId: TENANT }),
  resolvePortalContact: async () => ({ id: CONTACT, tenantId: TENANT }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    apiError: vi.fn((err: unknown) =>
      NR.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
    ),
  };
});
vi.mock('@/lib/offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/offers')>('@/lib/offers');
  return {
    ...actual,
    // Nothing in these two routes writes metadata or emails; stub the helpers
    // that would reach the pool so the real transition table stays the real one.
    patchOfferMetadata: vi.fn(async () => undefined),
    incrementOfferViewedCount: vi.fn(async () => undefined),
  };
});

import { OFFER_TRANSITIONS, allowedFromStatus } from '@/lib/offers';
import { POST as acceptPOST } from '@/app/api/public/quotes/[id]/accept/route';
import { POST as declinePOST } from '@/app/api/public/quotes/[id]/decline/route';

function requestFor(route: 'accept' | 'decline', body: unknown = { reason: 'too pricey' }) {
  return new NextRequest(new URL(`/api/public/quotes/${QUOTE}/${route}`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
}

async function call(route: 'accept' | 'decline', body: unknown = {}) {
  const handler = route === 'accept' ? acceptPOST : declinePOST;
  return (handler as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    requestFor(route, body),
    { params: Promise.resolve({ id: QUOTE }) },
  );
}

function quoteRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: QUOTE, tenantId: TENANT, contactId: CONTACT, dealId: null,
    title: 'Spring rollout', status: 'sent', expiresAt: null, totalAmount: '500.00',
    ...over,
  };
}

const STATUS_GUARD = /"quotes"\."status" in \(/i;

beforeEach(() => {
  vi.resetModules();
  state.quote = null;
  state.fresh = [];
  state.updateReturns = [];
  state.updates = [];
  state.inserted = [];
  state.audits = [];
  state.selects = 0;
});

describe('POST /api/public/quotes/[id]/accept — the claim is in the WHERE (#3177)', () => {
  it('a live accept claims `accepted` from the table\'s own from-set, tenant-scoped', async () => {
    state.quote = quoteRow();
    state.updateReturns = [[{ id: QUOTE }]];

    const res = await call('accept');
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const { sql, params, set } = state.updates[0]!;
    expect(sql).toMatch(STATUS_GUARD);
    expect(sql).toMatch(/"quotes"\."tenant_id"/i);
    expect(set.status).toBe('accepted');
    // id, tenant, then the from-set — read from OFFER_TRANSITIONS, not restated
    expect(params).toEqual([QUOTE, TENANT, ...OFFER_TRANSITIONS.accepted]);
    expect(state.inserted).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  it('a lost claim answers 409 with the committed status and writes no activity', async () => {
    // The seller's cancel committed between this read and this UPDATE.
    state.quote = quoteRow();
    state.updateReturns = [[]];
    state.fresh = [{ status: 'cancelled' }];

    const res = await call('accept');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe('cancelled');

    expect(state.updates).toHaveLength(1);
    expect(state.inserted).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it('the pre-read still refuses a status the table cannot move to `accepted`', async () => {
    state.quote = quoteRow({ status: 'accepted' });
    const res = await call('accept');
    expect(res.status).toBe(409);
    // checked against the read, so no statement is issued at all
    expect(state.updates).toHaveLength(0);
  });

  it('the auto-expire arm claims its from-set too, so it cannot bury an accept', async () => {
    state.quote = quoteRow({ expiresAt: new Date(Date.now() - 60_000) });
    state.updateReturns = [[{ id: QUOTE }]];

    const res = await call('accept');
    expect(res.status).toBe(410);
    expect(state.updates).toHaveLength(1);
    const { sql, params, set } = state.updates[0]!;
    expect(set.status).toBe('expired');
    expect(sql).toMatch(STATUS_GUARD);
    expect(params).toEqual([QUOTE, TENANT, ...OFFER_TRANSITIONS.expired]);
    expect(state.inserted).toHaveLength(0);
  });

  it('an expire that loses its claim reports the state that beat it', async () => {
    state.quote = quoteRow({ expiresAt: new Date(Date.now() - 60_000) });
    state.updateReturns = [[]];
    state.fresh = [{ status: 'accepted' }];

    const res = await call('accept');
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('accepted');
    expect(state.inserted).toHaveLength(0);
  });

  it('a claim that lost to a soft delete answers 404, not a status nobody can see', async () => {
    // #2382 applies to the re-read as much as to the pre-read: the row the buyer
    // thought they were accepting is gone, and `status: ''` would tell the page a
    // state that no quote has.
    state.quote = quoteRow();
    state.updateReturns = [[]];
    state.fresh = [];

    const res = await call('accept');
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});

describe('POST /api/public/quotes/[id]/decline — the claim is in the WHERE (#3177)', () => {
  it('a live decline claims `declined` from the table\'s own from-set, tenant-scoped', async () => {
    state.quote = quoteRow({ status: 'viewed' });
    state.updateReturns = [[{ id: QUOTE }]];

    const res = await call('decline', { reason: 'over budget' });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const { sql, params, set } = state.updates[0]!;
    expect(sql).toMatch(STATUS_GUARD);
    expect(sql).toMatch(/"quotes"\."tenant_id"/i);
    expect(set.status).toBe('declined');
    expect(params).toEqual([QUOTE, TENANT, ...OFFER_TRANSITIONS.declined]);
    expect(state.inserted).toHaveLength(1);
  });

  it('a decline that lands after a cancel no longer buries it', async () => {
    state.quote = quoteRow();
    state.updateReturns = [[]];
    state.fresh = [{ status: 'cancelled' }];

    const res = await call('decline', { reason: 'over budget' });
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('cancelled');
    expect(state.inserted).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it('a second decline tab does not restamp declinedAt or duplicate the activity', async () => {
    state.quote = quoteRow();
    state.updateReturns = [[]];
    state.fresh = [{ status: 'declined' }];

    const res = await call('decline', { reason: 'over budget' });
    expect(res.status).toBe(409);
    expect(state.updates).toHaveLength(1);
    expect(state.inserted).toHaveLength(0);
  });

  it('a decline that lost to a soft delete answers 404 with nothing written', async () => {
    state.quote = quoteRow();
    state.updateReturns = [[]];
    state.fresh = [];

    const res = await call('decline', { reason: 'over budget' });
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});

describe('the two portal routes read the shipped table, not a copy of it (#3177)', () => {
  it('accept and decline share OFFER_TRANSITIONS as their only from-set', () => {
    // The hand-copied `validStatuses = ['sent','viewed']` these routes used is
    // the same set the table declares — which is the point: it can no longer
    // drift from it, because there is only one.
    expect(allowedFromStatus('accepted')).toEqual(['sent', 'viewed']);
    expect(allowedFromStatus('declined')).toEqual(['sent', 'viewed']);
    expect(allowedFromStatus('expired')).toEqual(['sent', 'viewed']);
  });

  it('neither route writes an UPDATE with no status predicate anywhere', async () => {
    for (const route of ['accept', 'decline'] as const) {
      state.quote = quoteRow();
      state.updateReturns = [[{ id: QUOTE }]];
      state.updates = [];
      await call(route, { reason: 'x' });
      expect(state.updates, `${route} issued no UPDATE`).toHaveLength(1);
      expect(state.updates[0]!.sql, `${route} wrote without claiming a from-set`).toMatch(STATUS_GUARD);
      expect(state.updates[0]!.sql).toContain('"quotes"."tenant_id"');
    }
  });
});

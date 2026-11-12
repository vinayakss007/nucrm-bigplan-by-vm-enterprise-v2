/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3409 — the v1 API's create doors wrote rows no plan ceiling had priced.
 *
 * `POST /api/v1/leads` and `POST /api/v1/deals` are the paid, key-authenticated
 * surface. Both checked a scope and a rate limit and then inserted: no
 * `checkLimit`, and the deals door did not move `tenants.currentDeals` either —
 * the counter `deals/import` prices an entire batch against
 * (`currentDeals + rows.length > maxDeals`). So a tenant at its ceiling could
 * keep creating records through the API indefinitely, and its import ceiling
 * read small by exactly the number of deals this door had made.
 *
 * Both halves are pinned here, against the handlers themselves:
 *   1. over the ceiling -> the 402 from `checkLimit` is what the caller gets,
 *      and nothing is written;
 *   2. the gate is asked about the same resource the tenant door asks about
 *      (`leads` / `deals`), not a hand-picked one;
 *   3. under the ceiling -> the row is written, and for deals the counter bump
 *      lands in the SAME transaction as the insert (a separate write could
 *      commit the deal and lose the count).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const STAGE = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  writes: [] as string[],
  inTransaction: false,
}));

const checkLimit = vi.hoisted(() => vi.fn());
/** What the gate decided this request; every test sets it. */
const gate = vi.hoisted(() => ({ response: null as NextResponse | null }));

const ctx = {
  userId: USER,
  tenantId: TENANT,
  isAdmin: true,
  isSuperAdmin: false,
  roleSlug: 'manager',
  permissions: ['leads:write', 'deals:write'],
  email: 'manager@example.test',
  sessionId: 'session-1',
};

vi.mock('@/lib/auth/require-auth', () => ({ requireAuth: vi.fn(async () => ctx) }));
vi.mock('@/lib/auth/api-key', () => ({ requireApiKeyScope: vi.fn(() => null) }));
vi.mock('@/lib/rate-limit', () => ({
  limiters: {
    contacts: { check: vi.fn(async () => ({ allowed: true, reset: 0 })) },
    deals: { check: vi.fn(async () => ({ allowed: true, reset: 0 })) },
  },
}));
vi.mock('@/lib/usage/middleware', () => ({
  checkLimit: (...args: unknown[]) => {
    checkLimit(...args);
    return Promise.resolve(gate.response);
  },
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async (req: Request) => req.json() };
});
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/formula/sync', () => ({ syncCalculatedFields: vi.fn(async () => undefined) }));
vi.mock('@/lib/dev-logger', () => ({
  devLogger: { request: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

/** The drizzle statement every branch of the fake resolves to. */
function row(values: unknown[]) {
  return Object.assign(Promise.resolve(values), { returning: () => Promise.resolve(values) });
}

const tx = {
  insert: (table: unknown) => ({
    values: () => {
      state.writes.push(`insert:${tableName(table) ?? 'unknown'}`);
      return row([{ id: 'created-1', tenantId: TENANT, title: 'Deal', firstName: 'Ada', lastName: 'Lovelace' }]);
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        const key = Object.keys(values).join(',');
        state.writes.push(`update:${tableName(table) ?? 'unknown'}:${key}`);
        return row([]);
      },
    }),
  }),
};

function tableName(table: unknown): string | undefined {
  if (!table || typeof table !== 'object') return undefined;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : undefined;
}

const mockDb = vi.hoisted(() => ({ transaction: vi.fn(), insert: vi.fn(), select: vi.fn() }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'ak_test' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  state.writes.length = 0;
  state.inTransaction = false;
  gate.response = null;
  checkLimit.mockClear();
  mockDb.transaction.mockReset();
  mockDb.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    state.inTransaction = true;
    try {
      return await fn(tx);
    } finally {
      state.inTransaction = false;
    }
  });
  mockDb.insert.mockImplementation(tx.insert);
  mockDb.select.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) builder[m] = () => builder;
    builder['then'] = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res);
    return builder;
  });
});

async function loadLeadRoute() {
  return import('@/app/api/v1/leads/route');
}
async function loadDealRoute() {
  return import('@/app/api/v1/deals/route');
}

const refusal = () =>
  NextResponse.json(
    { error: 'Plan limit reached for deals', kind: 'deals', limit: 500, actual: 500, upgradeUrl: '/tenant/settings/billing' },
    { status: 402 },
  );

describe('the v1 API prices what it creates (#3409)', () => {
  it('POST /api/v1/leads refuses at the ceiling, before any write', async () => {
    gate.response = refusal();
    const { POST } = await loadLeadRoute();

    const res = await POST(post('/api/v1/leads', { first_name: 'Ada', last_name: 'Lovelace' }), undefined);

    expect(res!.status).toBe(402);
    expect(((await res!.json()) as { kind: string }).kind).toBe('deals');
    expect(state.writes, 'a refused create must not touch the database').toEqual([]);
  });

  it('asks the gate for the same resource the tenant door asks about', async () => {
    gate.response = refusal();
    const { POST } = await loadLeadRoute();

    await POST(post('/api/v1/leads', { first_name: 'Ada', last_name: 'Lovelace' }), undefined);

    // `leads` shares the contact pool — asking for `contacts` would price the
    // wrong table, and asking for nothing is what this route used to do.
    expect(checkLimit).toHaveBeenCalledTimes(1);
    expect(checkLimit.mock.calls[0]![1]).toBe('leads');
    expect((checkLimit.mock.calls[0]![0] as typeof ctx).tenantId).toBe(TENANT);
  });

  it('POST /api/v1/leads writes when the plan admits it, and opens no transaction it does not need', async () => {
    const { POST } = await loadLeadRoute();

    const res = await POST(post('/api/v1/leads', { first_name: 'Ada', last_name: 'Lovelace' }), undefined);

    expect(res!.status).toBe(201);
    expect(state.writes).toContain('insert:leads');
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('POST /api/v1/deals refuses at the ceiling and counts nothing', async () => {
    gate.response = refusal();
    const { POST } = await loadDealRoute();

    const res = await POST(post('/api/v1/deals', { title: 'Renewal', amount: 100, stage_id: STAGE }), undefined);

    expect(res!.status).toBe(402);
    expect(state.writes).toEqual([]);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('asks the gate for `deals` on POST /api/v1/deals', async () => {
    gate.response = refusal();
    const { POST } = await loadDealRoute();

    await POST(post('/api/v1/deals', { title: 'Renewal', amount: 100, stage_id: STAGE }), undefined);

    expect(checkLimit.mock.calls[0]![1]).toBe('deals');
  });

  it('bumps currentDeals inside the same transaction that writes the deal', async () => {
    const { POST } = await loadDealRoute();

    const res = await POST(post('/api/v1/deals', { title: 'Renewal', amount: 100, stage_id: STAGE }), undefined);

    expect(res!.status).toBe(201);
    // Order matters: the insert and the counter move are one unit of work, so a
    // failed bump rolls the deal back instead of leaving a row nothing counts.
    expect(state.writes).toEqual(['insert:deals', 'update:tenants:currentDeals']);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });
});

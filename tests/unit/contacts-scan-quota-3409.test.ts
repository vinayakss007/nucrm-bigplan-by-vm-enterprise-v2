/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3409 — the card scanner was the one contact door that did not charge the plan.
 *
 * `POST /api/tenant/contacts/scan` inserted a contact with no `plans.maxContacts`
 * check at all and then bumped `tenants.currentContacts` inside a `.catch()` —
 * best effort. Two separate holes in one file:
 *
 *   - a tenant at its ceiling could keep creating contacts by scanning business
 *     cards, because this door was never taught about the ceiling;
 *   - when the bump itself failed, the insert still committed, so the row existed
 *     and no later gate priced it. #1837 wrote the rule down for the main
 *     contacts door ("do NOT swallow; … letting it propagate keeps the row count
 *     and the counter atomic") and #3409 extended it to every other insert path;
 *     this one kept the swallow.
 *
 * Both halves are behaviour, not source shape, so they are pinned by running the
 * handler: a fake transaction that records what was written and can be made to
 * fail the counter update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
  /** rows the locked tenant/plan re-read answers with */
  lockedRows: [] as Array<{ currentContacts: number | null; maxContacts: number | null }>,
  /** makes the `currentContacts` UPDATE reject, the way a failed bump does */
  bumpFails: false,
  /** every write the transaction performed, in order */
  writes: [] as string[],
  /** did the transaction issue the FOR UPDATE read? */
  locked: false,
  /** how many transactions were opened (a refused pre-flight opens none) */
  transactions: 0,
  /** what the pre-flight answered; null means "let it through" */
  preflight: null as Response | null,
  /** whether the route's second, in-transaction decision applies */
  enforce: true,
}));

/** The drizzle table's SQL name (`Symbol.for('drizzle:Name')`), stable across module resets. */
function tableName(table: unknown): string | undefined {
  if (!table || typeof table !== 'object') return undefined;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : undefined;
}

/**
 * What a drizzle statement resolves to. A real promise, because the route awaits it,
 * chains `.returning()` on the insert and `.catch()` on the activity log — and the
 * counter bump must NOT have a catch left for it to use.
 */
function done(rows: unknown[] | 'bump'): Promise<unknown[]> {
  if (rows === 'bump' && state.bumpFails) return Promise.reject(new Error('counter update failed'));
  return Promise.resolve(rows as unknown[]);
}
function insertable(rows: unknown[]) {
  return Object.assign(done(rows), { returning: () => done(rows) });
}

const tx = {
  select: () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['from', 'innerJoin', 'where', 'limit']) builder[m] = chain;
    builder['for'] = () => {
      state.locked = true;
      return Promise.resolve(state.lockedRows);
    };
    return builder;
  },
  insert: (table: unknown) => ({
    values: () => {
      // `vi.resetModules()` gives the route its own copy of the schema module, so
      // identity comparison against this file's import would miss; the drizzle
      // table name is the stable handle.
      const isContacts = tableName(table) === 'contacts';
      const rows = isContacts
        ? (state.writes.push('insert:contacts'), [{ id: 'contact-1', firstName: 'Ada', tenantId: TENANT }])
        : (state.writes.push('insert:activities'), []);
      return insertable(rows);
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if (tableName(table) === 'tenants' && 'currentContacts' in values) {
          state.writes.push('update:counter');
          return done('bump');
        }
        state.writes.push('update:other');
        return done([]);
      },
    }),
  }),
};

const mockDb = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  // `apiError` inspects `InvalidJsonBodyError` from this module, so the real
  // exports stay and only the body reader is replaced.
  return { ...actual, readJsonBody: async (req: Request) => req.json() };
});
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () =>
    ({ userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: {}, isAdmin: false, isSuperAdmin: false }),
  requirePerm: () => null,
  withApiRouteCtx: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: async (_ctx: unknown, _entity: string, body: Record<string, unknown>) => ({
    body,
    stripped: [] as string[],
  }),
  enforceFieldRead: async (_ctx: unknown, _entity: string, rows: Record<string, unknown>[]) => rows,
}));
vi.mock('@/lib/field-sales/card-scanner', () => ({
  parseBusinessCard: () => ({ email: 'ada@example.com', phone: '+15550001', firstName: 'Ada' }),
  parseVCard: () => ({ email: 'ada@example.com', phone: '+15550001', firstName: 'Ada' }),
  normalizePhone: (p: string) => p,
  normalizeEmail: (e: string) => e,
  toContactPayload: () => ({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }),
  detectDuplicate: async () => ({ isDuplicate: false }),
}));
// `planLimitReachedResponse` stays REAL: the 402 body is the contract a client sees
// from the pre-flight and from the fence alike, so the test asserts the real one.
vi.mock('@/lib/usage/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/usage/middleware')>();
  return {
    ...actual,
    checkLimit: vi.fn(async () => state.preflight),
    limitsEnforce: vi.fn(() => state.enforce),
  };
});

async function callScan() {
  const { POST } = await import('@/app/api/tenant/contacts/scan/route');
  const req = new NextRequest('http://localhost/api/tenant/contacts/scan', {
    method: 'POST',
    body: JSON.stringify({ text: 'Ada Lovelace | ada@example.com', type: 'ocr' }),
    headers: { 'content-type': 'application/json' },
  });
  return (await POST(req, undefined)) as Response;
}

beforeEach(() => {
  vi.resetModules();
  state.lockedRows = [{ currentContacts: 3, maxContacts: 5 }];
  state.bumpFails = false;
  state.writes = [];
  state.locked = false;
  state.transactions = 0;
  state.preflight = null;
  state.enforce = true;
  mockDb.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    state.transactions += 1;
    return fn(tx);
  });
});

describe('the card scanner charges the plan like every other contact door (#3409)', () => {
  it('refuses at the ceiling: 402 and no contact row written', async () => {
    state.lockedRows = [{ currentContacts: 5, maxContacts: 5 }];
    const res = await callScan();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.kind).toBe('contacts');
    expect(body.limit).toBe(5);
    expect(body.actual).toBe(6);
    expect(state.writes).not.toContain('insert:contacts');
    expect(state.writes).not.toContain('update:counter');
  });

  it('decides the ceiling under a row lock, not on the pre-flight count alone', async () => {
    await callScan();
    expect(state.locked).toBe(true);
    expect(state.transactions).toBe(1);
  });

  it('admits under the ceiling, writes the contact and bumps the counter once', async () => {
    const res = await callScan();
    expect(res.status).toBe(201);
    expect(state.writes.filter((w) => w === 'insert:contacts')).toHaveLength(1);
    expect(state.writes.filter((w) => w === 'update:counter')).toHaveLength(1);
  });

  it('a NULL counter is priced, not left NULL by the bump', async () => {
    // COALESCE(currentContacts, 0) + 1 — without it, NULL + 1 is NULL, and a NULL
    // counter is costless to every ceiling check that follows.
    state.lockedRows = [{ currentContacts: null, maxContacts: 1 }];
    const res = await callScan();
    expect(res.status).toBe(201);
    expect(state.writes).toContain('update:counter');
  });

  it('a failed bump fails the create instead of committing a row nothing counts', async () => {
    state.bumpFails = true;
    const res = await callScan();
    expect(res.status).toBe(500);
  });

  it('the pre-flight refusal returns before any transaction is opened', async () => {
    state.preflight = new Response(JSON.stringify({ error: 'Plan limit reached for contacts', kind: 'contacts' }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    }) as Response;
    const res = await callScan();
    expect(res.status).toBe(402);
    expect(state.transactions).toBe(0);
    expect(state.writes).toHaveLength(0);
  });

  it('with enforcement off the write still bumps, and no lock is taken', async () => {
    state.enforce = false;
    const res = await callScan();
    expect(res.status).toBe(201);
    expect(state.locked).toBe(false);
    expect(state.writes).toContain('update:counter');
  });

});

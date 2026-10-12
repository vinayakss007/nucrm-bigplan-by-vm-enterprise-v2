/**
 * Tests for #2356 — /api/tenant/visitors/track must validate visitorId at the
 * boundary. A non-UUID previously threw 22P02 inside the write transaction,
 * the catch-all swallowed it, and the beacon got a 200: every visit from that
 * script was silently discarded forever. Now malformed ids answer 400 BEFORE
 * any database call, so "no db call at all" is part of the contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const VALID_VISITOR = 'b2222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => {
  const state = {
    dbCalls: 0,
    transactions: 0,
    upsertValues: undefined as unknown,
  };
  const chain: Record<string, unknown> = {};
  const count = () => {
    state.dbCalls += 1;
    return chain;
  };
  chain.from = count;
  chain.where = () => Promise.resolve([{ tenantId: 'a1111111-1111-4111-8111-111111111111' }]);
  const db = {
    select: vi.fn(() => chain),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      state.transactions += 1;
      const tx = {
        insert: vi.fn(() => ({
          values: (v: Record<string, unknown>) => ({
            onConflictDoUpdate: () => {
              if ('totalPageViews' in v) state.upsertValues = v;
              return Promise.resolve();
            },
          }),
        })),
      };
      return cb(tx);
    }),
  };
  return { state, db };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/lib/rate-limit-simple', () => ({ checkPublicRateLimit: vi.fn(() => undefined) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/visitor-tracking', () => ({ scorePageUrl: vi.fn(() => 5) }));

import { POST } from '@/app/api/tenant/visitors/track/route';

function trackRequest(body: unknown) {
  return new Request('http://localhost:3000/api/tenant/visitors/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'tracking-key' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.dbCalls = 0;
  m.state.transactions = 0;
  m.state.upsertValues = undefined;
});

describe('POST /api/tenant/visitors/track — visitorId validation (#2356)', () => {
  const malformed: Array<[string, unknown]> = [
    ['plain string', 'abc'],
    ['empty visitorId', ''],
    ['null visitorId', null],
    ['missing visitorId', { url: 'https://x.test' }],
    ['36-char non-UUID', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
    ['array', ['b2222222-2222-4222-8222-222222222222']],
    ['number', 123],
    ['structured id (not a uuid column value)', 'ACME-VS-4wr7jBDTEqVBCsXEih4zfP'],
  ];

  for (const [label, idOrBody] of malformed) {
    it(`answers 400 with NO db call for a malformed visitorId: ${label}`, async () => {
      const body =
        typeof idOrBody === 'object' && idOrBody !== null && !Array.isArray(idOrBody) && 'url' in (idOrBody as object)
          ? idOrBody
          : { visitorId: idOrBody, url: 'https://x.test' };
      const res = await POST(trackRequest(body));
      expect(res.status).toBe(400);
      expect(m.state.dbCalls).toBe(0);
      expect(m.state.transactions).toBe(0);
      expect(m.db.select).not.toHaveBeenCalled();
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBeTruthy();
      // no Postgres internals leak
      expect(JSON.stringify(json)).not.toMatch(/22P02|invalid input syntax|duplicate key|constraint/i);
    });
  }

  it('a valid UUID v4 keeps the 200 fire-and-forget contract and writes', async () => {
    const res = await POST(trackRequest({ visitorId: VALID_VISITOR, url: 'https://x.test/p' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(m.state.transactions).toBe(1);
    const values = m.state.upsertValues as Record<string, unknown>;
    expect(values.id).toBe(VALID_VISITOR);
  });

  it('missing url still answers 400 (pre-existing contract)', async () => {
    const res = await POST(trackRequest({ visitorId: VALID_VISITOR }));
    expect(res.status).toBe(400);
    expect(m.state.dbCalls).toBe(0);
  });

  it('no x-api-key still answers 401 before body parsing', async () => {
    const req = new Request('http://localhost:3000/api/tenant/visitors/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: VALID_VISITOR, url: 'https://x.test' }),
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(m.state.dbCalls).toBe(0);
  });

  it('the catch-all keeps returning 200 for genuinely transient failures', async () => {
    // e.g. the DB blips mid-write: the beacon must not break the page — only
    // SHAPE errors get 400 now
    m.db.transaction.mockRejectedValueOnce(new Error('connection reset by peer'));
    const res = await POST(trackRequest({ visitorId: VALID_VISITOR, url: 'https://x.test' }));
    expect(res.status).toBe(200);
  });
});

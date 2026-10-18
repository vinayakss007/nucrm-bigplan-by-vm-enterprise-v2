/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2825 — a portal read that FAILED must not be answered with an empty list.
 *
 * `public/quotes:66`, `public/tickets:83` and `public/kb/articles:55` wrapped
 * their whole handler in `try { … } catch { return 200 { data: [] } }`, and
 * `public/kb/articles/[id]:80` answered `404 Not found` for every throw. So a
 * `42501` RLS refusal, a dead pool or a missing column was rendered to a logged-in
 * customer as "you have nothing" — the same defect #2439 removed from
 * `public/invoices`, and #2446's reason the portal looked empty in the first
 * place.
 *
 * What is pinned here, per route:
 *   - a read that throws answers 5xx with `{ error }`, and never a payload the
 *     page could render as a result;
 *   - the honest empty case still answers `200 { data: [] }` — `!contact` is a
 *     real answer, a caught exception is not (#2438);
 *   - a missing/unpublished article stays 404 (#2284's anti-enumeration branch),
 *     while a failed read becomes 500;
 *   - an unauthenticated caller still gets 401, i.e. the new 500 did not
 *     swallow the auth exit that sits inside the same try.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = 'a0000000-0000-4000-8000-000000000001';
const ARTICLE = 'b0000000-0000-4000-8000-000000000002';

const state = vi.hoisted(() => ({
  identity: null as null | { email: string; tenantId: string },
  contact: null as null | { id: string; tenantId: string },
  /** What the tenant-scoped read resolves to; rejects when `readFails` is set. */
  rows: [] as unknown[],
  readFails: false,
}));

const logErrorMock = vi.hoisted(() => vi.fn());

/** Every drizzle builder method is a no-op except the terminal `limit()`. */
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'leftJoin', 'innerJoin', 'values', 'set', 'returning', 'onConflictDoUpdate']) {
    c[m] = () => c;
  }
  c.limit = () =>
    state.readFails
      ? Promise.reject(new Error('permission denied for table (42501)'))
      : Promise.resolve(state.rows);
  return c;
}

const tx = vi.hoisted(() => ({
  select: () => chain(),
  update: () => chain(),
  insert: () => chain(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: () => state.identity,
  resolvePortalContact: () => state.contact,
}));
vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: 'no-user',
  withTenantContext: async (_tenantId: string, _userId: string, cb: (t: unknown) => Promise<unknown>) =>
    cb(tx as never),
}));
vi.mock('@/lib/errors-server', () => ({ logError: logErrorMock }));

function get(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init) as unknown as NextRequest;
}

const quotesRoute = () => import('@/app/api/public/quotes/route');
const ticketsRoute = () => import('@/app/api/public/tickets/route');
const kbListRoute = () => import('@/app/api/public/kb/articles/route');
const kbDetailRoute = () => import('@/app/api/public/kb/articles/[id]/route');


/** The one assertion every failure path shares: nothing a page can render as rows. */
async function expectHonestFailure(res: Response, context: string) {
  const body = await res.json();
  expect(res.status, `${context}: a failed read answered ${res.status} — ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(500);
  expect(Array.isArray(body.data) ? body.data : undefined, `${context}: a failed read returned a list`).toBeUndefined();
  expect(typeof body.error).toBe('string');
  expect(logErrorMock, `${context}: the failure was not logged`).toHaveBeenCalled();
  expect(logErrorMock.mock.calls[0]![0].context).toBe(context);
}

beforeEach(() => {
  state.identity = { email: 'customer@corp.test', tenantId: TENANT };
  state.contact = { id: CONTACT, tenantId: TENANT };
  state.rows = [];
  state.readFails = false;
  logErrorMock.mockClear();
});

describe('portal list reads answer 5xx when the read failed (#2825)', () => {
  const lists = [
    { name: 'public/quotes', load: quotesRoute, url: '/api/public/quotes' },
    { name: 'public/tickets', load: ticketsRoute, url: '/api/public/tickets' },
    { name: 'public/kb/articles', load: kbListRoute, url: '/api/public/kb/articles?status=published' },
  ];

  for (const { name, load, url } of lists) {
    it(`${name}: a rejected read is a 5xx, not an empty list`, async () => {
      state.readFails = true;
      const { GET } = await load();
      await expectHonestFailure(await GET(get(url)), name);
    });

    it(`${name}: a successful read that found nothing is still 200 { data: [] }`, async () => {
      const { GET } = await load();
      const res = await GET(get(url));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: [] });
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it(`${name}: no identity is a 401, not the new 500`, async () => {
      state.identity = null;
      const { GET } = await load();
      const res = await GET(get(url));
      expect(res.status).toBe(401);
      expect(logErrorMock).not.toHaveBeenCalled();
    });
  }

  it('quotes and tickets still call an empty contact list honest (#2438)', async () => {
    state.contact = null;
    const { GET } = await quotesRoute();
    const res = await GET(get('/api/public/quotes'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('a read that returns rows is unaffected', async () => {
    state.rows = [{ id: ARTICLE, title: 'How to reset a password' }];
    const { GET } = await kbListRoute();
    const res = await GET(get('/api/public/kb/articles?status=published'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: state.rows });
  });
});

describe('the KB detail route separates "not there" from "could not look" (#2825)', () => {
  const ctx = { params: Promise.resolve({ id: ARTICLE }) };

  it('a rejected read answers 500, where it used to answer 404', async () => {
    state.readFails = true;
    const { GET } = await kbDetailRoute();
    await expectHonestFailure(await GET(get(`/api/public/kb/articles/${ARTICLE}`), ctx), 'public/kb/articles/[id]');
  });

  it('a row that matches no published, same-tenant article is still 404 (#2284)', async () => {
    state.rows = [];
    const { GET } = await kbDetailRoute();
    const res = await GET(get(`/api/public/kb/articles/${ARTICLE}`), ctx);
    expect(res.status).toBe(404);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('a published article is returned and counted', async () => {
    state.rows = [{ id: ARTICLE, title: 'Hello' }];
    const { GET } = await kbDetailRoute();
    const res = await GET(get(`/api/public/kb/articles/${ARTICLE}`), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.title).toBe('Hello');
  });
});

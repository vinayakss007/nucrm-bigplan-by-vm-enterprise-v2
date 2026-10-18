/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2774 (the numeric half) — both `analytics` POST handlers read a `numeric` out
 * of `db.execute` and cast it `as number || 0`.
 *
 * node-postgres hands `numeric` back as a **string** — there is no
 * `pg.setTypeParser` anywhere in this repo — so `probability` was `"0.1"` in the
 * JSON body while the cast said `number`, and the `|| 0` fallback could never
 * fire, because every non-empty string is truthy. `"0"` stayed `"0"`, and a
 * future `'NaN'`-ish value would sail straight into the response.
 *
 * Only the read is fixed here. What the score should *be* is the product
 * question #2774 still carries: `public.calculate_churn_risk` and
 * `public.calculate_deal_win_probability` are both `RETURN 0.1;` placeholders
 * (`drizzle/migrations/0032_missing_db_functions.sql`), and inventing a scoring
 * rule is not this PR's call.
 *
 * The existing harnesses for these routes (`churn-soft-deleted-2556.test.ts`)
 * hand back `{ probability: 0.42 }` — a number. That fiction is exactly why the
 * defect survived review: the shape the driver claimed to imitate was the shape
 * the cast assumed. Here the fake returns what the driver really returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';

const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({ rpcRows: [] as Record<string, unknown>[], ownerOk: true }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      let table = '';
      b['from'] = (t: object) => { table = getTableName(t as never); return b; };
      for (const m of ['where', 'innerJoin', 'orderBy', 'limit']) b[m] = () => b;
      b['then'] = (done: (v: unknown) => unknown) => {
        // The ownership probe and the stored-row read; which one is not
        // distinguished on purpose — both must answer for the handler to reach
        // the response, and the value under test comes from `execute`.
        const rows = table === 'churn_predictions' || table === 'deal_forecasts'
          ? []
          : (h.ownerOk ? [{ id: ENTITY }] : []);
        return Promise.resolve(rows).then(done);
      };
      return b;
    },
    execute: () => Promise.resolve({ rows: h.rpcRows }),
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const churn = await import('@/app/api/tenant/analytics/churn/route');
const forecast = await import('@/app/api/tenant/analytics/forecast/route');

void dialect;

const ctx = {
  userId: 'user-1', tenantId: TENANT, roleSlug: 'admin',
  permissions: { 'contacts.edit': true, 'deals.edit': true, 'reports.view': true },
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

async function post(route: 'churn' | 'forecast', body: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/analytics/${route}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  const handler = (route === 'churn' ? churn.POST : forecast.POST) as (r: NextRequest) => Promise<Response>;
  const res = await handler(req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

beforeEach(() => {
  h.rpcRows = [];
  h.ownerOk = true;
});

describe.each([
  ['churn', { contact_id: ENTITY }] as const,
  ['forecast', { deal_id: ENTITY }] as const,
])('POST /api/tenant/analytics/%s reads its numeric as the number the cast claims', (route, body) => {
  it('a numeric comes back from the driver as a string, and the body must not', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    const { status, json } = await post(route, body);
    expect(status).toBe(200);
    expect(typeof json['probability'], JSON.stringify(json)).toBe('number');
    expect(json['probability']).toBe(0.1);
  });

  it('a zero probability is zero, not the truthy string "0"', async () => {
    h.rpcRows = [{ probability: '0' }];
    const { json } = await post(route, body);
    expect(json['probability']).toBe(0);
    expect(typeof json['probability']).toBe('number');
  });

  it('an unusable value falls back to 0 instead of leaking through', async () => {
    for (const raw of [null, undefined, '', 'abc', 'NaN']) {
      h.rpcRows = [{ probability: raw }];
      const { status, json } = await post(route, body);
      expect(status).toBe(200);
      expect(json['probability'], `${String(raw)} must not survive as ${typeof raw}`).toBe(0);
    }
  });

  it('a numeric the driver did parse stays untouched', async () => {
    h.rpcRows = [{ probability: 0.42 }];
    const { json } = await post(route, body);
    expect(json['probability']).toBe(0.42);
  });

  it('an RPC that returns no row at all is 0, not a crash', async () => {
    h.rpcRows = [];
    const { status, json } = await post(route, body);
    expect(status).toBe(200);
    expect(json['probability']).toBe(0);
  });

  it('still refuses a contact or deal the caller may not touch', async () => {
    h.ownerOk = false;
    h.rpcRows = [{ probability: '0.1' }];
    const { status } = await post(route, body);
    expect(status).toBe(404);
  });
});

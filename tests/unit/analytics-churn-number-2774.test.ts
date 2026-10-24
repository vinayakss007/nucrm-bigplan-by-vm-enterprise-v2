/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2774 — `POST /api/tenant/analytics/churn` answered a hard-coded `0.1` and
 * dressed it as a computed churn risk.
 *
 * Two halves, both pinned here, and no scoring model invented:
 *
 * 1. the `numeric`-as-string read. `SELECT public.calculate_churn_risk(…)` is
 *    `numeric`, and node-postgres hands `numeric` back as a STRING because this
 *    repo has no `pg.setTypeParser`, so the old
 *    `(rows[0] as Record<string, unknown>)?.probability as number || 0` shipped
 *    `"probability": "0.1"` while the type said `number`, and `|| 0` could never
 *    fire because every non-empty string is truthy. The route now coerces with
 *    `Number(...)` and falls back on the *number*, the way #2815 (#2757's
 *    family) did for both analytics RPCs — which is why the numeric cases below
 *    are green at `origin/main`: they are a regression pin, not new behaviour.
 *    What is red at base is half 2.
 *
 * 2. honest source. `public.calculate_churn_risk`
 *    (`drizzle/migrations/0032_missing_db_functions.sql`) is `RETURN 0.1;` — it
 *    ignores `p_contact_id` and reads no `contacts`, activity or
 *    `churn_predictions` row, so every contact in every tenant scores the same
 *    stored constant. The response used to call that bare `probability` and the
 *    handler's doc comment called it "Calculate". Writing the real scoring rule
 *    is the product decision #2774 says the owner owes, so this file does not
 *    make it: the response now names where the number came from
 *    (`probabilitySource`, `probabilitySourceFunction`) and states that it was
 *    not modelled (`isModelled: false`), additively — every key that was there
 *    before is still there, unchanged in name, type and meaning.
 *
 * The fake hands back what the driver really hands back (a string), not the
 * `{ probability: 0.42 }` number that `churn-soft-deleted-2556.test.ts` claims
 * — that fiction is the shape the bad cast assumed, and is why this survived
 * review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

// RFC-2606 `.test` domains, and UUIDs built from the RFC-5737 TEST-NET ranges
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) so no fixture can collide
// with a row that exists somewhere.
const TENANT = '19200202-0202-4202-8202-020202020202';
const CONTACT = '19805100-0510-4510-8510-051005100510';
const PREDICTION_ID = '20301130-0113-4113-8113-011301130113';
const ORIGIN = 'https://tenant-a.test';

const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({
  /** what `db.execute` answers — the driver's real shape, i.e. strings. */
  rpcRows: [] as Record<string, unknown>[],
  /** the `churn_predictions` row the handler reads beside the RPC. */
  predictionRows: [] as Record<string, unknown>[],
  /** the #2524/#2777 ownership probe result. */
  ownerRows: [] as Record<string, unknown>[],
  /** `contacts.edit` gate, so the 403 path is reachable. */
  allowed: true,
  renderedSql: [] as string[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      let table = '';
      b['from'] = (t: object) => { table = getTableName(t as never); return b; };
      for (const m of ['where', 'innerJoin', 'orderBy', 'limit']) b[m] = () => b;
      b['then'] = (done: (v: unknown) => unknown) => {
        const rows = table === 'churn_predictions'
          ? h.predictionRows
          : table === 'contacts'
            ? h.ownerRows
            : [];
        return Promise.resolve(rows).then(done);
      };
      return b;
    },
    execute: (query: unknown) => {
      h.renderedSql.push(dialect.sqlToQuery(query as never).sql);
      return Promise.resolve({ rows: h.rpcRows });
    },
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => ctx),
    requirePerm: vi.fn(() => null),
    can: vi.fn(() => h.allowed),
  };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  // rethrow so a real defect surfaces as a failed test, not a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

const { POST } = await import('@/app/api/tenant/analytics/churn/route');

const ctx = {
  userId: 'user-owner-1',
  tenantId: TENANT,
  email: 'churn-owner@tenant-a.test',
  roleSlug: 'admin',
  permissions: { 'contacts.edit': true, 'contacts.view_all': true, 'reports.view': true },
  isAdmin: true,
  isSuperAdmin: false,
} as unknown as AuthContext;

/** A stored `churn_predictions` row, in the shape drizzle's `select()` answers. */
function predictionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PREDICTION_ID,
    tenantId: TENANT,
    contactId: CONTACT,
    // numeric, so the driver really does answer this as a string too — see the
    // pass-through case below.
    churnProbability: '0.85',
    churnRisk: 'high',
    riskFactors: ['no_reply_in_30_days'],
    recommendedActions: ['send_check_in'],
    isActioned: false,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...over,
  };
}

async function post(): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const req = new NextRequest(new URL('/api/tenant/analytics/churn', ORIGIN), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' },
    body: JSON.stringify({ contact_id: CONTACT }),
  });
  const res = await (POST as (r: NextRequest) => Promise<Response>)(req);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  h.rpcRows = [];
  h.predictionRows = [];
  h.ownerRows = [{ id: CONTACT }];
  h.allowed = true;
  h.renderedSql = [];
});

describe('POST /api/tenant/analytics/churn — the numeric half of #2774', () => {
  it('a numeric the driver returns as a string is a JSON number in the body', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    const { status, json, text } = await post();

    expect(status).toBe(200);
    expect(typeof json['probability'], text).toBe('number');
    expect(json['probability']).toBe(0.1);
    // the serialized body, not just the parsed one: no quoted value at that key
    expect(text).not.toMatch(/"probability"\s*:\s*"/);
    expect(text).toMatch(/"probability"\s*:\s*0\.1/);
  });

  it('a zero score is the number 0, not the truthy string "0"', async () => {
    h.rpcRows = [{ probability: '0' }];
    const { json, text } = await post();

    expect(json['probability']).toBe(0);
    expect(typeof json['probability']).toBe('number');
    expect(text).not.toMatch(/"probability"\s*:\s*"0"/);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a non-numeric string', 'abc'],
    ['the string "NaN"', 'NaN'],
    ['an object', {}],
  ])('a %s probability produces the documented fallback 0, not a leaked value', async (_label, raw) => {
    h.rpcRows = [{ probability: raw }];
    const { status, json, text } = await post();

    expect(status).toBe(200);
    expect(json['probability'], `${raw} must not survive into the body`).toBe(0);
    expect(typeof json['probability']).toBe('number');
    expect(json['probability']).not.toBe('0');
    expect(json['probability']).not.toBe(true);
    expect(text).toMatch(/"probability"\s*:\s*0/);
  });

  it('a missing RPC row is the fallback 0, not a crash and not undefined', async () => {
    h.rpcRows = [];
    const { status, json } = await post();

    expect(status).toBe(200);
    expect(json['probability']).toBe(0);
  });

  it('a numeric the driver did parse is passed through untouched', async () => {
    h.rpcRows = [{ probability: 0.42 }];
    const { json } = await post();

    expect(json['probability']).toBe(0.42);
  });

  it('the RPC really is the function the response names', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    const { json } = await post();

    expect(h.renderedSql.join('\n')).toMatch(/public\.calculate_churn_risk/);
    expect(json['probabilitySourceFunction']).toBe('public.calculate_churn_risk');
  });
});

describe('POST /api/tenant/analytics/churn — honest source, the other half of #2774', () => {
  it('the response says the score is a stored placeholder, not a modelled prediction', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    const { status, json } = await post();

    expect(status).toBe(200);
    expect(json['probabilitySource']).toBe('database_placeholder');
    expect(json['probabilitySourceFunction']).toBe('public.calculate_churn_risk');
    expect(json['isModelled'], 'nothing computes this value; it is RETURN 0.1').toBe(false);
    expect(typeof json['isModelled']).toBe('boolean');
  });

  it('the placeholder is reported as such even when the value is the fallback', async () => {
    h.rpcRows = [{ probability: 'abc' }];
    const { json } = await post();

    expect(json['probability']).toBe(0);
    expect(json['probabilitySource']).toBe('database_placeholder');
    expect(json['isModelled']).toBe(false);
  });

  it('is additive — no key that the response carried before is removed or retyped', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    h.predictionRows = [predictionRow()];
    const { json } = await post();

    // the pre-#2774 shape, intact
    expect(json['ok']).toBe(true);
    expect('probability' in json).toBe(true);
    expect('prediction' in json).toBe(true);
    expect(Object.keys(json).filter((k) => ['ok', 'probability', 'prediction'].includes(k)).sort())
      .toEqual(['ok', 'prediction', 'probability']);
    // …plus the new provenance keys
    expect(Object.keys(json).sort()).toEqual(
      ['isModelled', 'ok', 'prediction', 'probability', 'probabilitySource', 'probabilitySourceFunction'].sort(),
    );
  });

  it('the churn_predictions half is passed through untouched — it is the tenant\'s own row', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    const stored = predictionRow();
    h.predictionRows = [stored];
    const { json } = await post();

    expect(json['prediction']).toEqual(stored);
    // Deliberately not coerced: `prediction` is a raw drizzle row, and
    // `churnProbability` is `numeric`, so it arrives — and is answered — as the
    // string "0.85", exactly as GET /api/tenant/analytics/churn answers it.
    // Rewriting it here would make POST disagree with GET over one column; the
    // repo-wide numeric contract is the setTypeParser question, not this route's.
    expect(typeof (json['prediction'] as Record<string, unknown>)['churnProbability']).toBe('string');
    expect(json['isModelled']).toBe(false);
  });

  it('the two halves may disagree, and the route reconciles neither', async () => {
    // the constant 0.1 from the placeholder vs a stored 0.85 for this contact
    h.rpcRows = [{ probability: '0.1' }];
    h.predictionRows = [predictionRow()];
    const { json } = await post();

    expect(json['probability']).toBe(0.1);
    expect((json['prediction'] as Record<string, unknown>)['churnProbability']).toBe('0.85');
    expect((json['prediction'] as Record<string, unknown>)['churnRisk']).toBe('high');
    // neither value was overwritten by the other, and the disagreement is not
    // presented as a computed score
    expect(json['isModelled']).toBe(false);
    expect(json['probabilitySource']).toBe('database_placeholder');
  });

  it('a contact with no stored prediction still reports the placeholder honestly', async () => {
    h.rpcRows = [{ probability: '0.1' }];
    h.predictionRows = [];
    const { status, json } = await post();

    expect(status).toBe(200);
    expect('prediction' in json, 'undefined is dropped by JSON, as before').toBe(false);
    expect(json['probability']).toBe(0.1);
    expect(json['probabilitySource']).toBe('database_placeholder');
  });

  it('the RPC is never consulted for a contact the caller may not touch', async () => {
    h.ownerRows = [];
    h.rpcRows = [{ probability: '0.1' }];
    const { status, json } = await post();

    expect(status).toBe(404);
    expect(json['error']).toBe('Contact not found');
    expect(h.renderedSql).toEqual([]);
  });

  it('a caller without contacts.edit is refused before anything is read', async () => {
    h.allowed = false;
    const { status } = await post();

    expect(status).toBe(403);
    expect(h.renderedSql).toEqual([]);
  });
});

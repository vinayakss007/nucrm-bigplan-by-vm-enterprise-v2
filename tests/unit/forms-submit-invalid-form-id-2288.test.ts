/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2288: POST /api/forms/submit is public and unauthenticated. A non-UUID
// form_id used to reach the Postgres uuid cast and answer
// 500 {"error":"Internal server error"}. It must now answer 400 *before* any
// DB access, and any residual 22P02 escaping the handler must map to 400 via
// the shared classifier without leaking SQL/driver detail to the client.

const h = vi.hoisted(() => ({
  selectCalls: 0,
  // The promise the mocked `db.select(...).limit(1)` resolves/rejects with.
  limitResult: () => Promise.resolve([]) as Promise<unknown>,
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/formula/sync', () => ({ syncCalculatedFields: vi.fn(async () => undefined) }));
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      h.selectCalls += 1;
      const b: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where']) b[m] = () => b;
      b['limit'] = () => h.limitResult();
      return b;
    },
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/forms/submit/route';

async function submit(formId: unknown) {
  const req = new NextRequest('http://localhost/api/forms/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ form_id: formId, data: {} }),
  });
  return POST(req);
}

describe('POST /api/forms/submit — malformed form_id (#2288)', () => {
  beforeEach(() => {
    h.selectCalls = 0;
    h.limitResult = () => Promise.resolve([]);
  });

  it('400s the issue repro ("abc") before touching the DB', async () => {
    const res = await submit('abc');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid form id' });
    expect(h.selectCalls).toBe(0);
  });

  it('400s other non-uuid shapes: empty, quoted, path chars, over-long', async () => {
    for (const bad of [
      'not-a-uuid',
      '"0f9d0000-0000-4000-8000-000000000001"', // quoted uuid
      '../../etc/passwd',
      'x'.repeat(200),
      "1'; DROP TABLE forms;--",
    ]) {
      const res = await submit(bad);
      expect(res.status, `expected 400 for ${JSON.stringify(bad).slice(0, 40)}`).toBe(400);
      expect(h.selectCalls).toBe(0);
    }
  });

  it('lets a classic (RFC-4122) uuid through to the DB (404, not 400)', async () => {
    const res = await submit('0f9d0000-0000-4000-8000-000000000001');
    expect(h.selectCalls).toBe(1);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Form not found or inactive' });
  });

  it('lets the app legacy 5/6-prefixed seeded ids through (issue #2286 shape)', async () => {
    for (const legacy of [
      '50000000-0000-0000-0000-000000000001', // nil-variant, rejected by z.uuid()
      '60000000-0000-0000-0000-000000000010',
      '5abc0000-0000-0000-0000-000000000001',
    ]) {
      const before = h.selectCalls;
      const res = await submit(legacy);
      expect(h.selectCalls, `legacy id ${legacy} should reach the DB`).toBe(before + 1);
      expect(res.status).toBe(404); // not found, but never a 400 shape-reject
    }
  });

  it('maps a residual Postgres 22P02 (uuid cast) to 400 without SQL leakage', async () => {
    // drizzle/node-postgres wrap the pg error: SQL text on the outer message,
    // the SQLSTATE only on the nested cause — exactly what pgErrorOf walks.
    const outer = new Error(
      'select "forms"."id" from "forms" ... where "forms"."id" = $1 — parameters: 5abc-xyz',
    );
    (outer as unknown as { cause: unknown }).cause = {
      code: '22P02',
      message: 'invalid input syntax for type uuid: "5abc-xyz"',
    };
    h.limitResult = () => Promise.reject(outer);

    const res = await submit('5abc0000-0000-0000-0000-000000000001'); // uuid-shaped, passes the pre-check
    expect(h.selectCalls).toBe(1);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: 'Invalid identifier in request body' });
    // The SQL text / driver detail must not reach the client.
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('select');
    expect(raw).not.toContain('parameters');
    expect(raw).not.toContain('invalid input syntax');
  });

  it('still 500s on genuine server faults (not mapped by the classifier)', async () => {
    h.limitResult = () => Promise.reject(new Error('connection terminated unexpectedly'));
    const res = await submit('0f9d0000-0000-4000-8000-000000000001');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });
});

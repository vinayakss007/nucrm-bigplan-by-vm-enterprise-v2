/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3407 — `POST /api/tenant/tickets/bulk` wrote `status` to every selected id
 * with `WHERE id IN (...)` alone. A concurrent close/reopen landing after the
 * tenant-ownership read was silently stomped, and a closed ticket could be
 * moved straight to `resolved`, which the detail PATCH now refuses.
 *
 * The status action now reads each ticket's current state, drops the ones the
 * registry does not allow to reach the target, and issues one UPDATE per
 * from-state with that state in the WHERE. A ticket another writer moved in
 * the gap loses the claim and is reported as skipped, not overwritten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const dialect = new PgDialect({} as never);

type UpdateRec = {
  table: string;
  set: Record<string, unknown>;
  sql: string;
  params: unknown[];
};

const H = vi.hoisted(() => ({
  /** Rows for each outer `db.select(...).where()` (the ownership read). */
  selectRows: [] as unknown[][],
  /** `.returning()` rows for each transaction UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as UpdateRec[],
  audits: [] as Record<string, unknown>[],
}));

function recordUpdate(table: unknown, sink: UpdateRec[]): Record<string, unknown> {
  let rec: UpdateRec = { table: getTableName(table as never), set: {}, sql: '', params: [] };
  const node: Record<string, unknown> = {
    set: (values: Record<string, unknown>) => {
      rec = { ...rec, set: values };
      return node;
    },
    where: (predicate: unknown) => {
      const rendered = dialect.sqlToQuery(predicate as never);
      rec = { ...rec, sql: rendered.sql, params: rendered.params };
      return node;
    },
    returning: () => {
      sink.push(rec);
      return Promise.resolve(H.updateReturns.shift() ?? []);
    },
  };
  return node;
}

const tx: Record<string, unknown> = {
  update: vi.fn((table: unknown) => recordUpdate(table, H.updates)),
};

const db: Record<string, unknown> = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => Promise.resolve(H.selectRows.shift() ?? []),
    }),
  })),
  transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
};

vi.mock('@/drizzle/db', () => ({
  db: new Proxy({}, {
    get: (_target, property) => (db as Record<string | symbol, unknown>)[property],
  }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: TENANT, userId: USER }),
  requirePerm: async () => null,
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(handler: T): T => handler,
}));

vi.mock('@/lib/api/validate', () => ({
  readJsonBody: async (req: { json(): Promise<unknown> }) => req.json(),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: async () => null,
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    H.audits.push(entry);
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    apiError: (err: unknown) =>
      NR.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
  };
});

import { POST } from '@/app/api/tenant/tickets/bulk/route';

function bulkRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/tenant/tickets/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const bulk = async (body: unknown) => POST(bulkRequest(body));

function statusBody(ids: string[], status: string): unknown {
  return { action: 'status', ticket_ids: ids, payload: { status } };
}

beforeEach(() => {
  H.selectRows = [];
  H.updateReturns = [];
  H.updates = [];
  H.audits = [];
});

describe('#3407 bulk ticket status — registry and claim', () => {
  it('skips a closed ticket and claims each eligible from-state', async () => {
    H.selectRows = [[
      { id: 'a', status: 'open' },
      { id: 'b', status: 'in_progress' },
      { id: 'c', status: 'closed' },
    ]];
    H.updateReturns = [[{ id: 'a' }], [{ id: 'b' }]];

    const res = await bulk(statusBody(['a', 'b', 'c'], 'resolved'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, affected: 2, skipped: 1, action: 'status' });
    expect(H.updates).toHaveLength(2);
    expect(H.updates[0].params).toContain('open');
    expect(H.updates[1].params).toContain('in_progress');
    for (const update of H.updates) {
      expect(update.set.status).toBe('resolved');
      expect(update.sql).toContain('"support_tickets"."status" =');
      expect(update.sql).toContain('"support_tickets"."tenant_id" =');
      expect(update.sql).toContain('"support_tickets"."deleted_at" is null');
    }
    expect(H.audits).toHaveLength(1);
    expect(H.audits[0].newData).toMatchObject({ count: 2, skipped: 1, status: 'resolved' });
  });

  it('writes nothing when every selected ticket is ineligible', async () => {
    H.selectRows = [[{ id: 'c', status: 'closed' }]];

    const res = await bulk(statusBody(['c'], 'resolved'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, affected: 0, skipped: 1, action: 'status' });
    expect(H.updates).toHaveLength(0);
  });

  it('counts a ticket moved concurrently as skipped, not stomped', async () => {
    H.selectRows = [[{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }]];
    H.updateReturns = [[{ id: 'a' }]];

    const res = await bulk(statusBody(['a', 'b'], 'in_progress'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ affected: 1, skipped: 1 });
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].params).toContain('open');
  });

  it('allows resolved → closed', async () => {
    H.selectRows = [[{ id: 'r', status: 'resolved' }]];
    H.updateReturns = [[{ id: 'r' }]];

    const res = await bulk(statusBody(['r'], 'closed'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ affected: 1, skipped: 0 });
    expect(H.updates[0].params).toContain('resolved');
  });

  it('still rejects a status outside the bulk vocabulary', async () => {
    H.selectRows = [[{ id: 'a', status: 'open' }]];

    const res = await bulk(statusBody(['a'], 'pending'));

    expect(res.status).toBe(400);
    expect(H.updates).toHaveLength(0);
  });
});

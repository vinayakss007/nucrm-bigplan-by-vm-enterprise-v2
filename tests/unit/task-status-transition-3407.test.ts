/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the task PATCH wrote `status` with no from-state claim.
 *
 * The route read the current row but never included `status` in the UPDATE's
 * WHERE, so a stale "completed" or kanban drag could overwrite a concurrent
 * status change. This spec pins that a status write claims the exact status
 * that was read, that a lost claim answers 409, and that a non-status edit
 * does not claim status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const TASK = '55555555-5555-4555-8555-555555555555';
const dialect = new PgDialect({} as never);

type UpdateRec = { set: Record<string, unknown>; sql: string; params: unknown[] };

const H = vi.hoisted(() => ({
  selects: [] as Record<string, unknown>[][],
  updateReturns: [] as Record<string, unknown>[][],
  updates: [] as UpdateRec[],
}));

function recordUpdate(table: unknown): Record<string, unknown> {
  let rec: UpdateRec = { set: {}, sql: '', params: [] };
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
      H.updates.push(rec);
      return Promise.resolve(H.updateReturns.shift() ?? []);
    },
  };
  // keep getTableName called so a wrong-table write would be obvious in failures
  void getTableName(table as never);
  return node;
}

const db: Record<string, unknown> = {
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit', 'orderBy']) chain[method] = () =>
      method === 'limit' || method === 'orderBy' ? Promise.resolve(H.selects.shift() ?? []) : chain;
    return chain;
  }),
  update: vi.fn((table: unknown) => recordUpdate(table)),
};

vi.mock('@/drizzle/db', () => ({
  db: new Proxy({}, { get: (_t, p) => (db as Record<string | symbol, unknown>)[p] }),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: TENANT, userId: USER }),
  can: () => true,
  requirePerm: () => null,
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T): T => h }));
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async (req: { json(): Promise<unknown> }) => req.json() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/concurrency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/concurrency')>();
  return { ...actual };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/notification', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: async (_ctx: unknown, _e: unknown, body: unknown) => ({ body, stripped: [] }),
  enforceFieldRead: async (_ctx: unknown, _e: unknown, rows: unknown[]) => rows,
  attachStrippedFields: (res: unknown) => res,
}));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    apiError: (err: unknown) =>
      NR.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: (err as { statusCode?: number })?.statusCode ?? 500 },
      ),
  };
});

import { PATCH } from '@/app/api/tenant/tasks/[id]/route';

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/tenant/tasks/${TASK}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const patch = (body: unknown) =>
  PATCH(patchRequest(body), { params: Promise.resolve({ id: TASK }) });

function existing(status: string): Record<string, unknown> {
  return {
    id: TASK,
    status,
    assignedTo: USER,
    createdBy: USER,
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    title: 'Ship it',
  };
}

beforeEach(() => {
  H.selects = [];
  H.updateReturns = [];
  H.updates = [];
});

describe('#3407 task PATCH — status claim', () => {
  it('claims the exact status it read when the payload writes status', async () => {
    H.selects = [[existing('pending')]];
    H.updateReturns = [[{ id: TASK }]];

    const res = await patch({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].set.status).toBe('in_progress');
    expect(H.updates[0].sql).toContain('"tasks"."status" =');
    expect(H.updates[0].params).toContain('pending');
  });

  it('treats completed:true as a status write and claims the from-state', async () => {
    H.selects = [[existing('in_progress')]];
    H.updateReturns = [[{ id: TASK }]];

    const res = await patch({ completed: true });

    expect(res.status).toBe(200);
    expect(H.updates[0].set.status).toBe('completed');
    expect(H.updates[0].sql).toContain('"tasks"."status" =');
    expect(H.updates[0].params).toContain('in_progress');
  });

  it('answers 409 when a concurrent status change loses the claim', async () => {
    H.selects = [[existing('pending')]];
    H.updateReturns = [[]]; // UPDATE matched zero rows — status moved on

    const res = await patch({ status: 'completed' });

    expect(res.status).toBe(409);
  });

  it('does not claim status when only another field is edited', async () => {
    H.selects = [[existing('pending')]];
    H.updateReturns = [[{ id: TASK }]];

    const res = await patch({ priority: 'high' });

    expect(res.status).toBe(200);
    expect(H.updates[0].set.priority).toBe('high');
    expect(H.updates[0].sql).not.toContain('"tasks"."status" =');
  });
});

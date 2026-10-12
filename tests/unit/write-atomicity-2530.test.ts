/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2530 (part 1) — four sites wrote two rows in two separate commits, so a
 * failure between them left the database describing half an event:
 *
 *  - POST /api/tenant/reports/[id] — `saved_reports.last_run_at` was stamped on
 *    the pool before `report_executions` was written, so a failed insert left a
 *    report that looked freshly run with no history for that run.
 *  - POST /api/leads/public — the `companies` lookup+create ran on the pool
 *    BEFORE the capture transaction, so a lead that was never written still left
 *    a company record behind.
 *  - customer.subscription.updated / .deleted — the `tenants` write and the
 *    `subscriptions` write committed separately, so a throw in the helper moved
 *    the tenant and left the billing row stale: the permanent drift #2228 exists
 *    to prevent.
 *
 * The property that matters is not "the source mentions db.transaction" but
 * CONNECTION IDENTITY: both statements of a pair must arrive on the same
 * transaction connection, never on the pool, and must vanish together when the
 * second one fails.
 *
 * The double below models drizzle's contract rather than its shape: statements
 * issued inside `transaction(fn)` become durable only when `fn` resolves — a
 * throw discards them, because Postgres rolls the transaction back. Statements
 * issued on the pool are durable the moment they run. That is what makes the
 * rollback assertions below meaningful instead of tautological: on the base
 * revision the first write was already durable before the second could fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbClient } from '@/drizzle/db';

interface Stmt {
  conn: 'db' | 'tx';
  op: 'update' | 'insert' | 'execute' | 'read' | 'run';
  table: string;
  set?: Record<string, unknown>;
  raw?: unknown;
}

const H = vi.hoisted(() => ({
  state: {
    timeline: [] as Stmt[],
    committed: [] as Stmt[],
    discarded: [] as Stmt[],
    transactions: 0,
    /** '<op>:<table>' — the statement throws where drizzle would send it. */
    failOn: null as string | null,
    /** rows returned by `client.query.<name>.findFirst`, keyed by schema symbol */
    rows: {} as Record<string, unknown>,
    /** rows returned by any `client.select(...).from(...)` chain */
    selectRows: [] as unknown[],
  },
  tableOf: (table: unknown): string => {
    // drizzle stamps the SQL name on the table under this well-known symbol, so
    // the assertions are about which TABLE was written, not about source text.
    const name = (table as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : 'unknown';
  },
}));

vi.mock('@/drizzle/db', () => {
  const settle = <T>(rows: T[]) =>
    Object.assign(Promise.resolve(rows), {
      returning: async () => rows,
      limit: () => rows,
    });

  // Rejected, but still a drizzle-shaped builder: awaiting the chain, or the
  // `.returning()` on it, must surface the injected failure rather than a
  // TypeError about a missing method.
  const fail = (stmt: Stmt) => {
    const rejected = Promise.reject(new Error(`injected failure on ${stmt.op} ${stmt.table}`));
    return Object.assign(rejected, { returning: () => rejected, limit: () => rejected });
  };

  const makeClient = (conn: 'db' | 'tx', sink: Stmt[]) => {
    const record = (stmt: Stmt) => {
      H.state.timeline.push(stmt);
      sink.push(stmt);
      return H.state.failOn === `${stmt.op}:${stmt.table}` ? fail(stmt) : undefined;
    };

    return {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: (whereClause: unknown) => {
            const stmt: Stmt = { conn, op: 'update', table: H.tableOf(table), set: values, raw: whereClause };
            const failed = record(stmt);
            return failed ?? settle([]);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: () => {
          const stmt: Stmt = { conn, op: 'insert', table: H.tableOf(table) };
          const failed = record(stmt);
          return failed ?? settle([{ id: 'row-1' }]);
        },
      }),
      execute: (query: unknown) => {
        const failed = record({ conn, op: 'execute', table: 'sql', raw: query });
        return failed ?? Promise.resolve({ rows: [] });
      },
      delete: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
      query: new Proxy({}, {
        get: (_target, key: string) => ({
          findFirst: async () => {
            record({ conn, op: 'read', table: key });
            return H.state.rows[key] ?? null;
          },
          findMany: async () => {
            record({ conn, op: 'read', table: key });
            return Array.isArray(H.state.rows[key]) ? H.state.rows[key] : [];
          },
        }),
      }),
      select: () => ({
        from: (table: unknown) => {
          record({ conn, op: 'read', table: H.tableOf(table) });
          const chain: Record<string, unknown> = {
            where: () => settle(H.state.selectRows),
          };
          chain.innerJoin = () => chain;
          chain.leftJoin = () => chain;
          return chain;
        },
      }),
    };
  };

  // Statements on the pool commit as they run, so the pool writes straight into
  // the durable log.
  const db = makeClient('db', H.state.committed);
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    H.state.transactions += 1;
    const buffer: Stmt[] = [];
    const tx = makeClient('tx', buffer);
    try {
      const result = await fn(tx);
      H.state.committed.push(...buffer);
      return result;
    } catch (err) {
      H.state.discarded.push(...buffer);
      throw err;
    }
  };

  return { db };
});

// ── Route-level seams, kept inert so the timeline only shows DB statements. ──
const mockRunReport = vi.hoisted(() =>
  vi.fn(async () => {
    H.state.timeline.push({ conn: 'db', op: 'run', table: 'report_query' });
    return { rows: [{ a: 1 }, { b: 2 }] };
  }),
);

vi.mock('@/lib/api-error', () => ({
  apiError: () => Response.json({ error: 'injected failure' }, { status: 500 }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-1', tenantId: 'tenant-1', email: 'a@b.c', role: 'admin' })),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/app/api/tenant/reports/run/route', () => ({ runReportForTenant: mockRunReport }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks/idempotency', () => ({
  claimWebhookEvent: vi.fn(async () => 'ledger-row'),
  completeWebhookEvent: vi.fn(async () => undefined),
  releaseWebhookEvent: vi.fn(async () => undefined),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/cache/index', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, value: 'lock-val' })),
  releaseLock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  verifyWebhookSignature: async (body: string) => JSON.parse(body),
  StripeError: class StripeError extends Error {},
}));

import { POST as RUN_REPORT } from '@/app/api/tenant/reports/[id]/route';
import { POST as CAPTURE_LEAD } from '@/app/api/leads/public/route';
import { POST as STRIPE_WEBHOOK } from '@/app/api/webhooks/stripe/route';
import { syncSubscriptionRow, markSubscriptionCanceled } from '@/lib/stripe-subscription-sync';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const SUB_ID = 'sub_1TestAtomicity';

const sqlText = (arg: unknown): string =>
  new PgDialect().sqlToQuery(arg as Parameters<PgDialect['sqlToQuery']>[0]).sql;

const txOf = (table: string, op: Stmt['op']) =>
  H.state.committed.filter((s) => s.conn === 'tx' && s.table === table && s.op === op);
const poolOf = (table: string, op: Stmt['op']) =>
  H.state.committed.filter((s) => s.conn === 'db' && s.table === table && s.op === op);
const firstTxIndex = () => H.state.timeline.findIndex((s) => s.conn === 'tx');

/** A client that records what it was asked to write, for the helper units. */
function spyClient(hits: Record<string, unknown>[]): DbClient {
  return {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { hits.push(values); return { rowCount: 1 }; },
      }),
    }),
  } as unknown as DbClient;
}

function jsonPost(url: string, body: unknown): Promise<Response> {
  const handler = url.startsWith('/api/leads/public') ? CAPTURE_LEAD : RUN_REPORT;
  const request = new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  const result = url.startsWith('/api/leads/public')
    ? handler(request)
    : handler(request, { params: Promise.resolve({ id: REPORT_ID }) } as never);
  return Promise.resolve(result) as Promise<Response>;
}

function stripeEvent(type: string, object: Record<string, unknown>): NextRequest {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
  return {
    headers: { get: (h: string) => (h === 'stripe-signature' ? 't=1,v1=sig' : null) },
    text: async () => body,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Truncated in place: the pool client captured `state.committed` as its sink
  // when the mock was built, so reassigning it would silently orphan every
  // pool-side assertion below.
  H.state.timeline.length = 0;
  H.state.committed.length = 0;
  H.state.discarded.length = 0;
  H.state.transactions = 0;
  H.state.failOn = null;
  H.state.rows = {};
  H.state.selectRows = [];
});

describe('#2530 stripe-subscription-sync honours the caller transaction', () => {
  it('syncSubscriptionRow writes through the transaction it is handed', async () => {
    const hits: Record<string, unknown>[] = [];
    await syncSubscriptionRow({ id: SUB_ID }, 'pro', 'active', spyClient(hits));

    expect(hits).toHaveLength(1);
    // The pool double saw nothing: the helper no longer reaches around its caller.
    expect(poolOf('subscriptions', 'update')).toEqual([]);
  });

  it('syncSubscriptionRow still falls back to the pool when handed nothing', async () => {
    await syncSubscriptionRow({ id: SUB_ID }, null, 'active');

    const onPool = poolOf('subscriptions', 'update');
    expect(onPool).toHaveLength(1);
    expect(onPool[0]?.set).toMatchObject({ status: 'active' });
  });

  it('markSubscriptionCanceled writes through the transaction it is handed', async () => {
    const hits: Record<string, unknown>[] = [];
    await markSubscriptionCanceled(SUB_ID, spyClient(hits));

    expect(hits).toHaveLength(1);
    expect(poolOf('subscriptions', 'update')).toEqual([]);
  });

  it('normalizes the tenants vocabulary to the subscriptions one (#2228) via the transaction', async () => {
    const hits: Record<string, unknown>[] = [];
    await syncSubscriptionRow({ id: SUB_ID }, 'pro', 'cancelled', spyClient(hits));

    expect(hits[0]).toMatchObject({ status: 'canceled', planId: 'pro' });
  });
});

describe('#2530 POST /api/tenant/reports/[id] — one commit for run + history', () => {
  it('commits lastRunAt and the execution row on one transaction', async () => {
    H.state.selectRows = [{ reportType: 'leads', config: {} }];

    const res = await jsonPost('/api/tenant/reports/[id]', { filters: {} });

    expect(res.status).toBe(200);
    expect(H.state.transactions).toBe(1);
    expect(txOf('saved_reports', 'update')).toHaveLength(1);
    expect(txOf('report_executions', 'insert')).toHaveLength(1);
    // Neither write may stay on the pool — that is the split commit being fixed.
    expect(poolOf('saved_reports', 'update')).toEqual([]);
    expect(poolOf('report_executions', 'insert')).toEqual([]);
  });

  it('runs the report before opening the transaction', async () => {
    H.state.selectRows = [{ reportType: 'leads', config: {} }];

    await jsonPost('/api/tenant/reports/[id]', { filters: {} });

    const runAt = H.state.timeline.findIndex((s) => s.table === 'report_query');
    expect(runAt).toBeGreaterThanOrEqual(0);
    // The report query deliberately stays OUTSIDE: a transaction held open
    // across it would pin a connection for the whole run.
    expect(runAt).toBeLessThan(firstTxIndex());
  });

  it('leaves lastRunAt untouched when the execution row fails', async () => {
    H.state.selectRows = [{ reportType: 'leads', config: {} }];
    H.state.failOn = 'insert:report_executions';

    const res = await jsonPost('/api/tenant/reports/[id]', { filters: {} });

    expect(res.status).toBe(500);
    // Both statements were issued, and neither is durable: the stamp rolls back
    // with the history row instead of outliving it.
    expect(H.state.discarded.map((s) => s.table)).toEqual(['saved_reports', 'report_executions']);
    expect(H.state.committed.filter((s) => s.conn === 'tx')).toEqual([]);
  });
});

describe('#2530 POST /api/leads/public — the company belongs to the lead', () => {
  const capture = (company: string) => jsonPost('/api/leads/public', {
    email: 'someone@example.com',
    company,
    tenant_id: TENANT_ID,
  });

  it('creates the company inside the capture transaction, never on the pool', async () => {
    H.state.rows = { tenants: { id: TENANT_ID, name: 'Acme', ownerId: null }, companies: null, leads: null };
    H.state.selectRows = [{ currentContacts: 1, maxContacts: 1000 }];

    const res = await capture('Acme Industries');

    expect(res.status).toBe(201);
    expect(H.state.transactions).toBe(1);
    expect(txOf('companies', 'insert')).toHaveLength(1);
    expect(poolOf('companies', 'insert')).toEqual([]);
    // The lookup moved with the insert; a pool-side lookup is a stale read.
    expect(poolOf('companies', 'read')).toEqual([]);
    expect(H.state.timeline.some((s) => s.conn === 'tx' && s.op === 'read' && s.table === 'companies')).toBe(true);
  });

  it('issues the company statements before taking the advisory lock', async () => {
    H.state.rows = { tenants: { id: TENANT_ID, name: 'Acme', ownerId: null }, companies: null, leads: null };
    H.state.selectRows = [{ currentContacts: 1, maxContacts: 1000 }];

    await capture('Acme Industries');

    const companyAt = H.state.timeline.findIndex((s) => s.table === 'companies' && s.op === 'insert');
    const lockAt = H.state.timeline.findIndex(
      (s) => s.op === 'execute' && sqlText(s.raw).includes('pg_advisory_xact_lock'),
    );
    // Both sides must exist before their ORDER means anything — findIndex
    // returns -1, which compares happily against any positive index.
    expect(companyAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThanOrEqual(0);
    // ~200ms per statement in preprod: holding the per-email lock across the
    // company lookup+insert would serialize unrelated submissions for it.
    expect(companyAt).toBeLessThan(lockAt);
  });

  it('rolls the company row back when the lead insert fails', async () => {
    H.state.rows = { tenants: { id: TENANT_ID, name: 'Acme', ownerId: null }, companies: null, leads: null };
    H.state.selectRows = [{ currentContacts: 1, maxContacts: 1000 }];
    H.state.failOn = 'insert:leads';

    const res = await capture('Acme Industries');

    expect(res.status).toBe(500);
    expect(H.state.discarded.map((s) => s.table)).toContain('companies');
    // The defect being closed: a company record for a lead that was never captured.
    expect(poolOf('companies', 'insert')).toEqual([]);
  });
});

describe('#2530 Stripe subscription webhooks — tenant and billing row together', () => {
  const updated = () => ({
    id: SUB_ID,
    status: 'active',
    metadata: { tenant_id: TENANT_ID },
    items: { data: [] },
  });

  it('subscription.updated moves tenants and subscriptions on one transaction', async () => {
    H.state.rows = { tenants: { status: 'active' } };

    const res = await STRIPE_WEBHOOK(stripeEvent('customer.subscription.updated', updated()));

    expect(res.status).toBe(200);
    expect(H.state.transactions).toBe(1);
    expect(txOf('tenants', 'update')).toHaveLength(1);
    expect(txOf('subscriptions', 'update')).toHaveLength(1);
    expect(poolOf('tenants', 'update')).toEqual([]);
    expect(poolOf('subscriptions', 'update')).toEqual([]);
  });

  it('subscription.deleted downgrades the tenant and retires the row together', async () => {
    const res = await STRIPE_WEBHOOK(stripeEvent('customer.subscription.deleted', {
      id: SUB_ID, status: 'canceled', metadata: { tenant_id: TENANT_ID }, items: { data: [] },
    }));

    expect(res.status).toBe(200);
    expect(H.state.transactions).toBe(1);
    expect(txOf('tenants', 'update')[0]?.set).toMatchObject({ planId: 'free', stripeSubscriptionId: null });
    expect(txOf('subscriptions', 'update')[0]?.set).toMatchObject({ status: 'canceled' });
  });

  it('a failing subscriptions write rolls the tenant update back', async () => {
    H.state.rows = { tenants: { status: 'active' } };
    H.state.failOn = 'update:subscriptions';

    const res = await STRIPE_WEBHOOK(stripeEvent('customer.subscription.updated', updated()));

    expect(res.status).toBe(500);
    // The drift #2228 exists to remove: on the base revision the tenant had
    // already committed before the billing row could fail.
    expect(H.state.discarded.map((s) => s.table)).toEqual(['tenants', 'subscriptions']);
    expect(H.state.committed.filter((s) => s.conn === 'db' && s.op === 'update')).toEqual([]);
  });

  it('the terminal-status guard keeps its own pair atomic too', async () => {
    // A suspended tenant must not be re-activated, but the billing row is still
    // reconciled — and that branch is its own transaction, not the active one.
    H.state.rows = { tenants: { status: 'suspended' } };

    const res = await STRIPE_WEBHOOK(stripeEvent('customer.subscription.updated', updated()));

    expect(res.status).toBe(200);
    expect(H.state.transactions).toBe(1);
    expect(txOf('tenants', 'update')).toHaveLength(1);
    expect(txOf('subscriptions', 'update')).toHaveLength(1);
  });
});

/**
 * #2390 — a deleted webhook integration must be invisible *and* inert.
 *
 * DELETE on `/api/tenant/webhooks/[id]` is a tombstone UPDATE on `integrations`
 * (the table carries `utils.lifecycle()`), so the `ON DELETE cascade` FK from
 * `webhook_queue` never fires. Three readers disagreed with that:
 *
 *   - `fireWebhooks()` filtered `isActive` only, so every event kept enqueuing
 *     HMAC-signed deliveries to a URL the customer had removed;
 *   - the retry sweep never looked at the parent at all, so it also retried
 *     through an *inactive* integration that `fireWebhooks` would have skipped;
 *   - the retry path spelled the success state `success` while the send path and
 *     the `delivered_count` subquery both read `delivered`.
 *
 * The predicates are asserted as **rendered SQL** against the real drizzle
 * schema, not against a mock's return value — a filter that exists in the source
 * but never reaches the WHERE clause is exactly the bug this file is about. The
 * inertness half is proven by counting `safeFetch` calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain
type Any = any;

const TENANT = '11111111-1111-4111-8111-111111111111';
const HOOK = '33333333-3333-4333-8333-333333333333';

interface Stmt {
  kind: string;
  table: unknown;
  where?: unknown;
  set?: unknown;
}

const h = vi.hoisted(() => ({
  nodes: [] as Stmt[],
  selectRows: [] as unknown[],
  updateRows: [] as unknown[],
  sent: [] as string[],
}));

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as Any).sql;

/** A chainable recorder: drizzle builds the statement, we keep the pieces. */
function makeChain(kind: string, table: unknown): Any {
  let where: unknown;
  let set: unknown;
  const record = () => h.nodes.push({ kind, table, where, set });
  const self: Any = {
    from: (t: unknown) => makeChain(kind, t),
    where: (w: unknown) => { where = w; return self; },
    set: (s: unknown) => { set = s; return self; },
    values: () => self,
    orderBy: () => self,
    limit: () => self,
    offset: () => self,
    groupBy: () => self,
    innerJoin: () => self,
    leftJoin: () => self,
    returning: () => { record(); return Promise.resolve(h.updateRows); },
    then: (res: Any, rej?: Any) => {
      record();
      const out = kind.endsWith('update') || kind.endsWith('insert') ? h.updateRows : h.selectRows;
      return Promise.resolve(out).then(res, rej);
    },
    catch: (rej: Any) => Promise.resolve(h.selectRows).catch(rej),
  };
  return self;
}

vi.mock('@/drizzle/db', () => {
  const db: Any = {
    select: () => { const c = makeChain('select', undefined); c.from = (t: unknown) => makeChain('select', t); return c; },
    insert: (t: unknown) => makeChain('insert', t),
    update: (t: unknown) => makeChain('update', t),
    transaction: (fn: Any) => fn({
      select: () => { const c = makeChain('tx.select', undefined); c.from = (t: unknown) => makeChain('tx.select', t); return c; },
      update: (t: unknown) => makeChain('tx.update', t),
      insert: (t: unknown) => makeChain('tx.insert', t),
    }),
    execute: () => Promise.resolve([]),
    query: {},
  };
  return { db };
});

vi.mock('@/lib/security/ssrf', () => ({
  SsrfBlockedError: class SsrfBlockedError extends Error { reason = 'test'; },
  safeFetch: (url: string) => {
    h.sent.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
  },
  checkSaveTimeUrlSafety: () => null,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const hookRow = {
  id: HOOK,
  tenantId: TENANT,
  type: 'webhook',
  name: 'Customer webhook',
  isActive: true,
  config: { url: 'https://customer.example/hook', events: [], secret: 's3cr3t' },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.nodes = [];
  h.selectRows = [];
  h.updateRows = [];
  h.sent = [];
});

/** The first recorded statement against `table`, of the given kind. */
function stmt(kind: string, table: unknown): Stmt {
  const found = h.nodes.find((n) => n.kind === kind && n.table === table);
  expect(found, `no ${kind} statement was built against the expected table`).toBeDefined();
  return found!;
}

describe('fireWebhooks (#2390)', () => {
  it('excludes tombstoned integrations from the selection', async () => {
    h.selectRows = [hookRow];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks(TENANT, 'contact.created', { id: '1' });

    const sql = render(stmt('select', integrations).where);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
    // An addition, not a replacement — the predicates it already had must stay.
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
    expect(sql).toMatch(/"?type"?\s*=/i);
    expect(sql).toMatch(/"?is_active"?\s*=/i);
  });

  it('still delivers to a live integration (the filter is not a blanket no-op)', async () => {
    h.selectRows = [hookRow];
    // The enqueue INSERT must hand back the row, or fireWebhooks skips the
    // delivery for a reason that has nothing to do with the predicate here.
    h.updateRows = [{ id: 'delivery-1', attempt: 0 }];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks(TENANT, 'contact.created', { id: '1' });
    expect(h.sent).toEqual(['https://customer.example/hook']);
  });

  it('sends nothing when the selection comes back empty', async () => {
    h.selectRows = [];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks(TENANT, 'contact.created', { id: '1' });
    expect(h.sent).toEqual([]);
  });
});

describe('retryFailedWebhooks (#2390)', () => {
  async function retrySql() {
    h.selectRows = [];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    await retryFailedWebhooks();
    return render(stmt('select', webhookQueue).where);
  }

  it('only retries rows whose parent integration is alive and active', async () => {
    const sql = await retrySql();
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM integrations/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/is_active = true/i);
    expect(sql).toMatch(/"webhook_queue"\."webhook_id"/);
  });

  it('still keeps its own status / attempt / due predicates', async () => {
    const sql = await retrySql();
    expect(sql).toMatch(/"?status"?\s*=/i);
    expect(sql).toMatch(/"?attempt"?\s*<\s*\$/i);
    expect(sql).toMatch(/"?next_retry_at"?\s*<=\s*\$/i);
  });

  it('never POSTs to an integration the sweep was not given', async () => {
    h.selectRows = [];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    expect(await retryFailedWebhooks()).toBe(0);
    expect(h.sent).toEqual([]);
  });
});

describe('drainDeletedWebhookQueue (#2390)', () => {
  it('retires failed rows whose parent is gone, without sending', async () => {
    h.updateRows = [{ id: 'q1' }, { id: 'q2' }];
    const { drainDeletedWebhookQueue } = await import('@/lib/webhooks');
    const n = await drainDeletedWebhookQueue();

    expect(n).toBe(2);
    expect(h.sent).toEqual([]);
    const upd = stmt('update', webhookQueue);
    expect(upd.set).toMatchObject({ status: 'dead_letter', nextRetryAt: null });
    expect(typeof (upd.set as Any).errorMessage).toBe('string');
  });

  it('drains only a deleted parent — a paused one keeps its queue', async () => {
    h.updateRows = [];
    const { drainDeletedWebhookQueue } = await import('@/lib/webhooks');
    await drainDeletedWebhookQueue();
    const sql = render(stmt('update', webhookQueue).where);
    expect(sql).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM integrations/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/"?status"?\s*=\s*\$/i);
    // Re-enabling a paused webhook must find its pending retries still there,
    // so `is_active` must not appear in the drain predicate.
    expect(sql).not.toMatch(/is_active/i);
  });

  it('reports 0 rather than throwing when nothing matches', async () => {
    h.updateRows = [];
    const { drainDeletedWebhookQueue } = await import('@/lib/webhooks');
    expect(await drainDeletedWebhookQueue()).toBe(0);
  });
});

describe('retry status vocabulary (#2390)', () => {
  it('writes the successful-retry state the counters read', async () => {
    h.selectRows = [{
      id: 'q1', webhookId: HOOK, tenantId: TENANT, url: 'https://customer.example/hook',
      headers: {}, payload: { event: 'contact.created' }, attempt: 1, status: 'failed',
      createdAt: new Date(),
    }];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    await retryFailedWebhooks();

    expect(h.sent).toEqual(['https://customer.example/hook']);
    const statuses = h.nodes.filter((n) => n.kind === 'update').map((n) => (n.set as Any).status);
    // 'success' was a second spelling of the state the send path and the
    // delivered_count subquery call 'delivered'.
    expect(statuses).toContain('delivered');
    expect(statuses).not.toContain('success');
  });
});

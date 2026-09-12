/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for the audit LIST endpoint filter bugs (#661 / HIGH #9).
 *
 * Fixed here:
 *  - `search` now escapes LIKE metacharacters (was: `_`/`%` acted as wildcards).
 *  - `from`/`to` dates are validated (was: `Invalid Date` fed straight into SQL,
 *    silently returning zero rows), and a date-only `to` is inclusive of the day.
 *  - edit_history is correlated to the page's exact (entity_type, entity_id)
 *    pairs (was: two independent IN-subqueries — a cartesian mismatch).
 *
 * The db mock records each select's WHERE and serves an ordered result queue:
 * [count] then [logs] then [fieldChanges].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const h = vi.hoisted(() => ({
  wheres: [] as unknown[],
  queue: [] as unknown[][],
}));

vi.mock('@/drizzle/db', () => {
  const reader = () => {
    const self: any = {
      from: () => self,
      leftJoin: () => self,
      where: (c: unknown) => {
        h.wheres.push(c);
        return self;
      },
      orderBy: () => self,
      offset: async () => h.queue.shift() ?? [],
      // `where` is terminal for the count query; support both awaited shapes.
      then: (res: any, rej?: any) => Promise.resolve(h.queue.shift() ?? []).then(res, rej),
      limit: () => self,
    };
    return self;
  };
  return { db: { select: () => reader() } };
});

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    isAdmin: true,
    isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

/** Collect all bound string params from a Drizzle condition tree. */
function collectStrings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 16 || node === null || typeof node !== 'object') {
    if (typeof node === 'string') out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectStrings(n, out, depth + 1);
    return out;
  }
  for (const v of Object.values(node as Record<string, unknown>)) collectStrings(v, out, depth + 1);
  return out;
}

async function callAudit(qs: string) {
  const { GET } = await import('@/app/api/tenant/audit/route');
  const req = new Request(`http://localhost/api/tenant/audit?${qs}`);
  return GET(req as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.wheres = [];
  h.queue = [];
});

describe('audit filters — search escaping (#661)', () => {
  it('escapes LIKE metacharacters in the search term', async () => {
    h.queue.push([{ count: 0 }]); // count
    h.queue.push([]);             // logs (empty -> no field-change query)

    await callAudit('search=' + encodeURIComponent('a_b%c'));

    // The ILIKE pattern must contain the escaped form, not raw wildcards.
    const params = collectStrings(h.wheres[0]);
    expect(params.some((p) => p.includes('a\\_b\\%c'))).toBe(true);
    expect(params.some((p) => p === '%a_b%c%')).toBe(false);
    // The route import chain is heavy; allow headroom on slow/loaded runners.
  }, 30000);
});

describe('audit filters — date validation (#661)', () => {
  it('rejects an invalid "from" date with 400 instead of querying', async () => {
    const res = await callAudit('from=not-a-date');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/from/i) });
    // No query should have run.
    expect(h.wheres).toHaveLength(0);
  });

  it('rejects an invalid "to" date with 400', async () => {
    const res = await callAudit('to=13/13/2026');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/to/i) });
  });

  it('accepts a valid date range', async () => {
    h.queue.push([{ count: 0 }]);
    h.queue.push([]);
    const res = await callAudit('from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
  });
});

describe('audit filters — edit_history correlation (#661)', () => {
  it('does NOT query edit_history when the page has no entity ids', async () => {
    h.queue.push([{ count: 1 }]);
    // A log with no resource_id -> no pairs -> no field-change query.
    h.queue.push([{ id: 'l1', resource_type: 'contact', resource_id: null }]);

    const res = await callAudit('');
    expect(res.status).toBe(200);
    // Only count + logs selects ran (2 wheres), never the edit_history one.
    expect(h.wheres).toHaveLength(2);
  });

  it('correlates edit_history to the exact (type,id) pairs on the page', async () => {
    h.queue.push([{ count: 2 }]);
    h.queue.push([
      { id: 'l1', resource_type: 'contact', resource_id: 'c1' },
      { id: 'l2', resource_type: 'deal', resource_id: 'd1' },
    ]);
    h.queue.push([]); // field changes

    const res = await callAudit('');
    expect(res.status).toBe(200);

    // The edit_history WHERE (3rd recorded) should reference the concrete ids,
    // proving we match pairs from the page rather than re-running subqueries.
    const ehParams = collectStrings(h.wheres[2]);
    expect(ehParams).toContain('c1');
    expect(ehParams).toContain('d1');
  });
});

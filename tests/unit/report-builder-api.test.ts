import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { executed } = vi.hoisted(() => ({ executed: [] as unknown[] }));

// #1615: routes/pages now run inside withPinnedConnection (via withApiRoute /
// withTenantScope). In unit tests there is no real pool, so stub the primitive
// to run the callback directly (matches tests/unit/auth-middleware-require-auth.test.ts).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

import { NextResponse } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'test-user-001',
    tenantId: 'test-tenant-001',
    email: 'test@nucrm.com',
    isAdmin: true,
    isSuperAdmin: false,
    permissions: { all: true },
    roleSlug: 'admin',
  })),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
}));

vi.mock('@/lib/api-error', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiError: vi.fn((err: any, _msg?: string, status = 500) =>
    NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
  ),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      executed.push(query);
      return {
        rows: [
          { label: 'new', value: 15 },
          { label: 'contacted', value: 8 },
          { label: 'qualified', value: 5 },
        ],
      };
    }),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: { tenantId: 'tenant_id' },
  deals: { tenantId: 'tenant_id' },
  tasks: { tenantId: 'tenant_id' },
  companies: { tenantId: 'tenant_id' },
  activities: { tenantId: 'tenant_id' },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function testRequest(path: string, options: { method?: string; body?: any } = {}) {
  const url = new URL(path, 'http://localhost:3000');
  const init: RequestInit & { headers: Record<string, string> } = {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json' },
  };
  if (options.body && options.method !== 'GET') {
    init.body = JSON.stringify(options.body);
  }
  return new Request(url, init);
}

describe('POST /api/tenant/reports/builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns report data with correct structure', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_status',
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('total');
    expect(json).toHaveProperty('meta');
    expect(json.meta.entity).toBe('contacts');
    expect(json.meta.metric).toBe('count');
    expect(json.meta.groupBy).toBe('lead_status');
    expect(json.meta.generatedAt).toBeDefined();
  });

  it('calculates percentages correctly', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_status',
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(json.total).toBe(28);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalPct = json.data.reduce((s: number, d: any) => s + d.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('rejects invalid entity', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'users',
        metric: 'count',
        groupBy: 'status',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('Invalid entity');
  });

  it('rejects invalid metric', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'median',
        groupBy: 'lead_status',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('Invalid metric');
  });

  it('requires groupBy field', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('groupBy is required');
  });

  it('requires metricField for sum metric', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'deals',
        metric: 'sum',
        groupBy: 'stage',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('metricField is required');
  });

  it('rejects invalid groupBy field (SQL injection prevention)', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_status; DROP TABLE contacts;--',
      },
    });

    // A groupBy outside the allowlist is bad input, not a server fault. It used
    // to be answered 500 by a Postgres "column does not exist" from the
    // injection string reaching the query; the allowlist check now runs before
    // any SQL is built, so nothing reaches the database at all.
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('Invalid groupBy');
  });
});

describe('GET /api/tenant/reports/builder', () => {
  it('returns available entities and dimensions', async () => {
    const { GET } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toHaveProperty('entities');
    expect(json.entities).toBeInstanceOf(Array);
    expect(json.entities.length).toBeGreaterThan(0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contacts = json.entities.find((e: any) => e.id === 'contacts');
    expect(contacts).toBeDefined();
    expect(contacts.groupByOptions).toBeInstanceOf(Array);
    expect(contacts.metricOptions).toBeInstanceOf(Array);
    expect(contacts.groupByOptions.length).toBeGreaterThan(0);
  });

  it('exposes the expanded entity set (quotes, invoices, tickets, leads)', async () => {
    const { GET } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder');
    const response = await GET(request);
    const json = await response.json();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = json.entities.map((e: any) => e.id);
    for (const id of ['quotes', 'invoices', 'tickets', 'leads']) {
      expect(ids).toContain(id);
    }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoices = json.entities.find((e: any) => e.id === 'invoices');
    expect(invoices.metricOptions.some((m: { field: string }) => m.field === 'total_amount')).toBe(true);
  });
});

describe('expanded entities', () => {
  it('accepts the new entities in POST validation', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'quotes',
        metric: 'sum',
        metricField: 'total_amount',
        groupBy: 'status',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('rejects an invalid groupBy field for the new entities', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const request = testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'invoices',
        metric: 'count',
        groupBy: 'total_amount',
      },
    });

    // total_amount is a valid metricField for invoices but not a dimension, and
    // an unusable groupBy is a 400 now rather than a 500 from the database.
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('Invalid groupBy');
  });
});

/**
 * POST documented `filters`, forwarded them to the engine, and the engine never
 * read them — a caller narrowing a report got the unfiltered totals with no
 * signal that the narrowing had been dropped.
 */
describe('report builder filters', () => {
  const render = (): { sql: string; params: unknown[] } => {
    const last = executed[executed.length - 1];
    return new PgDialect().sqlToQuery(last as never);
  };

  beforeEach(() => {
    executed.length = 0;
  });

  it('narrows the query by one value', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const response = await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_source',
        filters: { lead_status: 'won' },
      },
    }));

    expect(response.status).toBe(200);
    const query = render();
    expect(query.sql).toContain('(COALESCE("lead_status"::text, \'Unknown\')) = $2');
    expect(query.params).toContain('won');
  });

  it('widens a list of values into one predicate', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'tasks',
        metric: 'count',
        groupBy: 'assigned_to',
        filters: { priority: ['high', 'urgent'] },
      },
    }));

    const query = render();
    expect(query.sql).toContain('in (');
    expect(query.params).toContain('high');
    expect(query.params).toContain('urgent');
  });

  it('keeps the filter value a bound parameter, never SQL text', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_source',
        filters: { lead_status: "x'; DROP TABLE contacts;--" },
      },
    }));

    const query = render();
    expect(query.sql).not.toContain('DROP TABLE');
    expect(query.params.some(p => String(p).includes('DROP TABLE'))).toBe(true);
  });

  it('rejects a filter on a field that is not a dimension', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const response = await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_source',
        filters: { password_hash: 'x' },
      },
    }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('Invalid filter field');
    // rejected before anything was built, so nothing reached the database
    expect(executed).toHaveLength(0);
  });

  it('answers a mistyped date with 400 instead of a driver error', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const response = await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_status',
        dateRange: { from: 'last tuesday' },
      },
    }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('dateRange.from is not a valid date');
    expect(executed).toHaveLength(0);
  });

  it('ignores a filter whose value box is empty', async () => {
    const { POST } = await import('@/app/api/tenant/reports/builder/route');

    const response = await POST(testRequest('/api/tenant/reports/builder', {
      method: 'POST',
      body: {
        entity: 'contacts',
        metric: 'count',
        groupBy: 'lead_source',
        filters: { lead_status: '' },
      },
    }));

    expect(response.status).toBe(200);
    // groupBy is lead_source; lead_status must not appear at all.
    const query = render();
    expect(query.sql).not.toContain('"lead_status"');
    expect(query.params).not.toContain('');
  });
});

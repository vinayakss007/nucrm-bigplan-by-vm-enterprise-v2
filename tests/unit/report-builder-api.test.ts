import { describe, it, expect, vi, beforeEach } from 'vitest';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiError: vi.fn((err: any, _msg?: string, status = 500) =>
    NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
  ),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn(async () => ({
      rows: [
        { label: 'new', value: 15 },
        { label: 'contacted', value: 8 },
        { label: 'qualified', value: 5 },
      ],
    })),
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const response = await POST(request);
    expect(response.status).toBe(500);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contacts = json.entities.find((e: any) => e.id === 'contacts');
    expect(contacts).toBeDefined();
    expect(contacts.groupByOptions).toBeInstanceOf(Array);
    expect(contacts.metricOptions).toBeInstanceOf(Array);
    expect(contacts.groupByOptions.length).toBeGreaterThan(0);
  });
});

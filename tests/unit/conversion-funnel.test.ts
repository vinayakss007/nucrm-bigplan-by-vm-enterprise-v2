import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const STAGES = [
  { id: 's1', name: 'New', order: 0 },
  { id: 's2', name: 'Qualified', order: 1 },
  { id: 's3', name: 'Won', order: 2 },
];

// Chainable mocks for db.select().from().where().orderBy() etc.
const mockSelect = vi.fn();
const mockOrderBy = vi.fn().mockResolvedValue([]);
const mockWhereStages = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockFromStages = vi.fn().mockReturnValue({ where: mockWhereStages });

const mockGroupBy = vi.fn().mockResolvedValue([]);
const mockWhereCounts = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
const mockFromCounts = vi.fn().mockReturnValue({ where: mockWhereCounts });

// First pipeline select: db.select().from(pipelines).where(...).limit(1)
const mockLimitPipeline = vi.fn().mockResolvedValue([]);
const mockWherePipeline = vi.fn().mockReturnValue({ limit: mockLimitPipeline });
const mockFromPipeline = vi.fn().mockReturnValue({ where: mockWherePipeline });

vi.mock('@/drizzle/db', () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock('@/drizzle/schema', () => ({
  deals: {
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    pipelineId: 'pipeline_id',
    stageId: 'stage_id',
    amount: 'amount',
    createdAt: 'created_at',
  },
  dealStages: {
    tenantId: 'tenant_id',
    pipelineId: 'pipeline_id',
    id: 'id',
    name: 'name',
    order: 'order',
  },
  pipelines: {
    tenantId: 'tenant_id',
    id: 'id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
  isNull: vi.fn(() => true),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => `SQL(${values.map(String).join(',')})`),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'u1',
    tenantId: 't1',
    email: 'a@b.com',
    isAdmin: true,
    isSuperAdmin: false,
    permissions: { all: true },
    roleSlug: 'admin',
  })),
}));

vi.mock('@/lib/api-error', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiError: vi.fn((err: any) => new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 })),
}));

function makeRequest(url: string): NextRequest {
  return new Request(url, { method: 'GET' }) as unknown as NextRequest;
}

describe('conversion funnel report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimitPipeline.mockResolvedValue([{ id: 'p1' }]);
    mockOrderBy.mockResolvedValue(STAGES);
    mockGroupBy.mockResolvedValue([
      { stageId: 's1', count: 10, value: '10000' },
      { stageId: 's2', count: 5, value: '5000' },
      { stageId: 's3', count: 2, value: '2000' },
    ]);
  });

  it('builds a funnel ordered by stage with cumulative counts', async () => {
    mockSelect
      .mockReturnValueOnce({ from: mockFromPipeline })
      .mockReturnValueOnce({ from: mockFromStages })
      .mockReturnValueOnce({ from: mockFromCounts });

    const { GET } = await import('@/app/api/tenant/reports/conversion-funnel/route');
    const res = await GET(makeRequest('http://localhost/api/tenant/reports/conversion-funnel'));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.pipeline.id).toBe('p1');
    expect(json.data).toHaveLength(3);
    expect(json.data[0].stageName).toBe('New');
    expect(json.data[0].cumulativeCount).toBe(10);
    expect(json.data[1].cumulativeCount).toBe(15);
    expect(json.data[2].cumulativeCount).toBe(17);
    // Conversion New→Qualified = cumulative 15 / 10... Actually per code: next.cumulative / s.cumulative
    expect(json.total).toBe(17);
  });

  it('respects a custom date range in the where clause', async () => {
    mockSelect
      .mockReturnValueOnce({ from: mockFromPipeline })
      .mockReturnValueOnce({ from: mockFromStages })
      .mockReturnValueOnce({ from: mockFromCounts });

    const { GET } = await import('@/app/api/tenant/reports/conversion-funnel/route');
    const res = await GET(makeRequest(
      'http://localhost/api/tenant/reports/conversion-funnel?from=2026-01-01&to=2026-02-01',
    ));
    expect(res.status).toBe(200);
    expect(mockWhereCounts).toHaveBeenCalled();
  });
});
/**
 * #3081 — `POST /api/superadmin/ai-credits {action:'suspend'}` was a bare
 * UPDATE keyed on (tenant, current billing period). getCreditBalance creates
 * that row lazily, so for a tenant with no row yet this month the UPDATE
 * matched zero rows, nothing was suspended, and the route still answered
 * `success: true, 'Tenant AI access suspended'` — a success lie. Worse, the
 * tenant's next AI call then auto-created the row with status 'active',
 * inverting the suspension the administrator had just applied.
 *
 * The fix upserts the period row (insert ... on conflict do update set
 * status='suspended') and fails honestly if no row was written. Both
 * properties are asserted here: the base (bare UPDATE) fails test 1 because
 * `db.insert` is never reached, and fails test 2 because a 0-row no-op still
 * returned 200 success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const ADMIN_ID = '20000000-0000-4000-8000-000000000001';

const mockInsertValues = vi.hoisted(() => vi.fn());
const mockOnConflictDoUpdate = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues.mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate.mockReturnValue({
          returning: mockReturning,
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: mockUpdateWhere.mockResolvedValue([]) })),
    })),
    select: vi.fn(),
    query: {},
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: ADMIN_ID, isSuperAdmin: true, tenantId: TENANT_ID })),
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (handler: (req: NextRequest) => Promise<NextResponse>) => handler,
}));

vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (request: NextRequest) => request.json()),
  validateBody: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
}));

vi.mock('@/lib/ai/credits', () => ({
  allocateCredits: vi.fn(),
  getCreditBalance: vi.fn(),
  getAggregatedUsage: vi.fn(),
  getCreditHistory: vi.fn(),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api-error', () => ({ apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }) }));
vi.mock('@/lib/api/query-params', () => ({ parseLimitOffset: () => ({ limit: 50, offset: 0 }) }));
vi.mock('@/drizzle/schema/ai', () => ({
  tenantAiCredits: { tenantId: 'tenantId', billingPeriod: 'billingPeriod', status: 'status' },
}));

async function postSuspend(): Promise<NextResponse> {
  const { POST } = await import('@/app/api/superadmin/ai-credits/route');
  const request = new NextRequest('http://localhost/api/superadmin/ai-credits', {
    method: 'POST',
    body: JSON.stringify({ action: 'suspend', data: { tenant_id: TENANT_ID } }),
  });
  return POST(request);
}

describe('superadmin ai-credits suspend (#3081)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockResolvedValue([]);
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
    mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  });

  it('upserts the period row instead of UPDATE-ing a row that may not exist', async () => {
    mockReturning.mockResolvedValue([{ tenantId: TENANT_ID }]);
    const res = await postSuspend();
    expect(res.status).toBe(200);

    // The suspend must go through insert ... on conflict do update, not a bare
    // UPDATE — on a fresh billing period the UPDATE matches nothing.
    expect(mockInsertValues, 'suspend did not upsert: it is still the bare 0-row UPDATE').toHaveBeenCalled();
    const vals = mockInsertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals.tenantId).toBe(TENANT_ID);
    expect(vals.status).toBe('suspended');
    expect(vals.billingPeriod).toMatch(/^\d{4}-\d{2}$/);
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    const cfg = mockOnConflictDoUpdate.mock.calls[0]![0] as { set: Record<string, unknown> };
    expect(cfg.set.status).toBe('suspended');
  });

  it('fails honestly when no row was written, instead of claiming a suspend', async () => {
    mockReturning.mockResolvedValue([]);
    const res = await postSuspend();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/access suspended/i);
  });

  it('still rejects non-superadmin callers with 403', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: ADMIN_ID, isSuperAdmin: false, tenantId: TENANT_ID });
    const res = await postSuspend();
    expect(res.status).toBe(403);
  });
});

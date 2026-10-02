/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Saved Reports had no create path and no working run.
 *
 * Nothing in the app inserted into `saved_reports`, so the page that lists it
 * could only ever be empty and every `/api/tenant/reports/[id]` route could
 * only 404. Meanwhile "Run" called `public.execute_saved_report`, a plpgsql
 * stub returning `{rows: [], total: 0}` whatever the data was — a report that
 * looked faithfully empty rather than obviously broken. These tests pin the
 * create route and the executor that replaced the stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRunReport } = vi.hoisted(() => ({
  mockRunReport: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  can: vi.fn(),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/app/api/tenant/reports/run/route', async (importOriginal) => {
  const mod = await importOriginal<object>();
  return { ...mod, runReportForTenant: (...args: unknown[]) => mockRunReport(...args) };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let insertValues: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let insertResult: any[] = [];
let lookupRows: unknown[] = [];
const updated: unknown[][] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => lookupRows,
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues = { table, value };
        return { returning: () => insertResult };
      },
    }),
    update: () => ({
      set: (value: unknown) => {
        updated.push(value);
        return { where: () => ({ returning: () => [] }) };
      },
    }),
  },
}));

const { POST: CREATE } = await import('@/app/api/tenant/reports/saved/route');
const { POST: RUN } = await import('@/app/api/tenant/reports/[id]/route');

const { requireAuth, can } = await import('@/lib/auth/middleware');
const ctx = { userId: 'user-1', tenantId: 'tenant-1', email: 'a@b.c', role: 'admin' };

const ID = '11111111-1111-4111-8111-111111111111';

function post(url: string, body: unknown, params = { id: ID }): Promise<Response> {
  return (async () => {
    const handler = url.startsWith('/api/tenant/reports/saved') ? CREATE : RUN;
    return handler(
      new Request(`http://x${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve(params) } as never,
    );
  })();
}

describe('POST /api/tenant/reports/saved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues = null;
    insertResult = [];
    vi.mocked(requireAuth).mockResolvedValue(ctx as never);
    vi.mocked(can).mockReturnValue(true as never);
    mockRunReport.mockResolvedValue({ rows: [], reportType: 'contacts' });
  });

  it('creates the row the list page reads, with the author recorded', async () => {
    insertResult = [{ id: ID, name: 'Deal value by stage', reportType: 'deals' }];
    const res = await post('/api/tenant/reports/saved', {
      name: 'Deal value by stage',
      report_type: 'deals',
      config: { filters: { stage: 'Negotiation' } },
      chart_type: 'bar',
    });

    expect(res.status).toBe(201);
    expect(insertValues.value).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Deal value by stage',
      reportType: 'deals',
      chartType: 'bar',
      isPublic: false,
      createdBy: 'user-1',
    });
    expect(await res.json()).toEqual({ ok: true, data: insertResult[0] });
  });

  it('refuses a report_type the executor cannot run', async () => {
    // Saving a report that can never produce rows is how the page got here.
    const res = await post('/api/tenant/reports/saved', { name: 'Nonsense', report_type: 'invoices' });
    expect(res.status).toBe(400);
    expect(insertValues).toBeNull();
  });

  it('refuses an unnamed report', async () => {
    const res = await post('/api/tenant/reports/saved', { name: '   ', report_type: 'contacts' });
    expect(res.status).toBe(400);
    expect(insertValues).toBeNull();
  });

  it('requires reports.create', async () => {
    vi.mocked(can).mockReturnValue(false as never);
    const res = await post('/api/tenant/reports/saved', { name: 'X', report_type: 'contacts' });
    expect(res.status).toBe(403);
    expect(insertValues).toBeNull();
  });

  it('does not write for an unauthenticated caller', async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never);
    const res = await post('/api/tenant/reports/saved', { name: 'X', report_type: 'contacts' });
    expect(res.status).toBe(401);
    expect(insertValues).toBeNull();
  });

  it('accepts the aggregate report types the runner supports', async () => {
    insertResult = [{ id: ID }];
    const res = await post('/api/tenant/reports/saved', { name: 'Pipeline', report_type: 'pipeline' });
    expect(res.status).toBe(201);
    expect(insertValues.value.reportType).toBe('pipeline');
  });
});

describe('POST /api/tenant/reports/[id] — running a saved report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupRows = [{ reportType: 'contacts', config: { filters: { lead_source: 'web' } } }];
    insertValues = null;
    updated.length = 0;
    insertResult = [];
    vi.mocked(requireAuth).mockResolvedValue(ctx as never);
    vi.mocked(can).mockReturnValue(true as never);
    mockRunReport.mockResolvedValue({ rows: [{ id: 'c-1' }, { id: 'c-2' }], reportType: 'contacts' });
  });

  it('runs the stored config through the real executor, not the db stub', async () => {
    const res = await post(`/api/tenant/reports/${ID}`, {});
    expect(res.status).toBe(200);

    expect(mockRunReport).toHaveBeenCalledWith('tenant-1', {
      report_type: 'contacts',
      filters: { lead_source: 'web' },
      limit: undefined,
    });
    const body = await res.json();
    expect(body.data).toEqual({ rows: [{ id: 'c-1' }, { id: 'c-2' }], total: 2, page: 1 });
  });

  it('lets the request override the stored filters', async () => {
    await post(`/api/tenant/reports/${ID}`, { filters: { lead_source: 'referral' } });
    expect(mockRunReport.mock.calls[0][1]).toMatchObject({ filters: { lead_source: 'referral' } });
  });

  it('records the run so the history is not permanently empty', async () => {
    await post(`/api/tenant/reports/${ID}`, {});
    expect(insertValues.table).toBeDefined();
    expect(insertValues.value).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      reportId: ID,
      status: 'completed',
      resultCount: 2,
    });
    expect(updated[0]).toMatchObject({ lastRunAt: expect.any(Date) });
  });

  it('404s a report the tenant does not have, before running anything', async () => {
    lookupRows = [];
    const res = await post(`/api/tenant/reports/${ID}`, {});
    expect(res.status).toBe(404);
    expect(mockRunReport).not.toHaveBeenCalled();
  });

  it('passes an executor rejection back as the client error it is', async () => {
    mockRunReport.mockResolvedValue({ error: 'Unknown field \'nope\' for report \'contacts\'', status: 400 });
    const res = await post(`/api/tenant/reports/${ID}`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown field/);
    expect(insertValues).toBeNull();
  });

  it('rejects a path segment that is not a uuid', async () => {
    const res = await post('/api/tenant/reports/usage', {}, { id: 'usage' });
    expect(res.status).toBe(400);
    expect(mockRunReport).not.toHaveBeenCalled();
  });
});

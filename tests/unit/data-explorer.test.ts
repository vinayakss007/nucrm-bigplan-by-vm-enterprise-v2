import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('@/lib/api/validate', () => ({
  validateBody: vi.fn(),
  // Routes parse bodies through readJsonBody so a malformed body becomes a 400
  // rather than a 500; the real implementation just delegates to request.json().
  readJsonBody: vi.fn((request: Request) => request.json()),
}));

vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((_err: unknown) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }),
}));

import { GET, PUT, DELETE } from '@/app/api/tenant/data-explorer/route';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { NextRequest, NextResponse } from 'next/server';

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(url, init);
}

function makeExecuteResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length };
}

describe('GET /api/tenant/data-explorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthorized when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for unknown entity type', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=invalid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unknown entity type');
  });

  it('returns empty results for contacts with no data', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=contacts'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
  });

  it('returns contacts matching search query', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    const mockRows = [
      { id: '1', first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com' },
    ];
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '1' }]))
      .mockResolvedValueOnce(makeExecuteResult(mockRows));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=contacts&q=Alice'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].first_name).toBe('Alice');
    expect(body.total).toBe(1);
  });

  it('returns deals with correct structure', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    const mockRows = [
      { id: '1', title: 'Big Deal', amount: '50000', stage_id: 'negotiation' },
    ];
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '1' }]))
      .mockResolvedValueOnce(makeExecuteResult(mockRows));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=deals'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].title).toBe('Big Deal');
  });

  it('returns companies with correct structure', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=companies'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('returns tasks with correct structure', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=tasks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('returns leads with correct structure', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=leads'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('respects page and limit parameters', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '100' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=contacts&page=3&limit=10'));
    const body = await res.json();
    expect(body.page).toBe(3);
    expect(body.limit).toBe(10);
    expect(body.hasMore).toBe(true);
  });

  it('limits max page size to 200', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=contacts&limit=500'));
    const body = await res.json();
    expect(body.limit).toBe(200);
  });

  it('uses field/value filter when provided', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecuteResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeExecuteResult([]));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer?type=contacts&field=email&value=test'));
    expect(res.status).toBe(200);
  });

  it('handles DB error gracefully', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest('http://localhost/api/tenant/data-explorer'));
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/tenant/data-explorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthorized when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const res = await PUT(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: '1', field: 'first_name', value: 'Bob' }),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 404 when record not found', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute).mockResolvedValue(makeExecuteResult([]));

    const { validateBody } = await import('@/lib/api/validate');
    vi.mocked(validateBody).mockReturnValue({
      success: true,
      data: { table: 'contacts', id: 'nonexistent', field: 'first_name', value: 'Bob' },
    } as never);

    const res = await PUT(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: 'nonexistent', field: 'first_name', value: 'Bob' }),
    }));
    expect(res.status).toBe(404);
  });

  it('updates a record successfully', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute).mockResolvedValue(makeExecuteResult([{ id: '1', first_name: 'Bob' }]));

    const { validateBody } = await import('@/lib/api/validate');
    vi.mocked(validateBody).mockReturnValue({
      success: true,
      data: { table: 'contacts', id: '1', field: 'first_name', value: 'Bob' },
    } as never);

    const res = await PUT(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: '1', field: 'first_name', value: 'Bob' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('handles invalid field names', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);

    const { validateBody } = await import('@/lib/api/validate');
    vi.mocked(validateBody).mockReturnValue({
      success: true,
      data: { table: 'contacts', id: '1', field: '', value: 'Bob' },
    } as never);

    const res = await PUT(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: '1', field: '', value: 'Bob' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/tenant/data-explorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthorized when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const res = await DELETE(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: '1' }),
    }));
    expect(res.status).toBe(401);
  });

  it('soft-deletes a record successfully', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute).mockResolvedValue(makeExecuteResult([{ id: '1' }]));

    const { validateBody } = await import('@/lib/api/validate');
    vi.mocked(validateBody).mockReturnValue({
      success: true,
      data: { table: 'contacts', id: '1' },
    } as never);

    const res = await DELETE(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: '1' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when record not found for deletion', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    vi.mocked(db.execute).mockResolvedValue(makeExecuteResult([]));

    const { validateBody } = await import('@/lib/api/validate');
    vi.mocked(validateBody).mockReturnValue({
      success: true,
      data: { table: 'contacts', id: 'nonexistent' },
    } as never);

    const res = await DELETE(makeRequest('http://localhost/api/tenant/data-explorer', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'contacts', id: 'nonexistent' }),
    }));
    expect(res.status).toBe(404);
  });
});

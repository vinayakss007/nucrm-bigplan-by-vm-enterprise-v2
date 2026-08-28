import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1544 F6: export endpoint ergonomics (GET -> 405 + Allow) and streamed CSV.

describe('POST /api/tenant/export route - F6 ergonomics & streaming', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('@/lib/api/mutating-rate-limit', () => ({
      rateLimitMutating: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock('@/lib/auth/middleware', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        tenantId: 'test-tenant',
        userId: 'test-user',
        isAdmin: true,
        isSuperAdmin: false,
      }),
      requirePerm: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('@/lib/api/validate', () => ({
      readJsonBody: vi.fn().mockResolvedValue({ entity: 'contacts', format: 'csv' }),
    }));
  });

  function mockDbRows(rows: unknown[]) {
    vi.doMock('@/drizzle/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      },
    }));
  }

  it('GET returns 405 with Allow: POST header and informative JSON', async () => {
    mockDbRows([]);
    const { GET } = await import('@/app/api/tenant/export/route');
    const res = await GET();

    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');

    const body = await res.json();
    expect(body.error).toContain('Method Not Allowed');
    expect(body.error).toContain('POST /api/tenant/export');
  });

  it('POST csv export streams a correctly-formatted CSV body', async () => {
    const rows = [
      { id: '1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      { id: '2', firstName: 'Smith, John', lastName: 'Doe', email: 'jd@example.com' },
    ];
    mockDbRows(rows);

    const { POST } = await import('@/app/api/tenant/export/route');
    const req = new Request('http://localhost:3000/api/tenant/export', { method: 'POST' });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="contacts-export.csv"');

    const text = await res.text();
    const expected = [
      'id,firstName,lastName,email',
      '1,Ada,Lovelace,ada@example.com',
      // "Smith, John" contains a comma so escapeCSV wraps it in quotes.
      '2,"Smith, John",Doe,jd@example.com',
    ].join('\n');

    expect(text).toBe(expected);
  });

  it('POST csv export with no rows returns an empty 200 CSV', async () => {
    mockDbRows([]);

    const { POST } = await import('@/app/api/tenant/export/route');
    const req = new Request('http://localhost:3000/api/tenant/export', { method: 'POST' });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="contacts-export.csv"');
    expect(await res.text()).toBe('');
  });
});

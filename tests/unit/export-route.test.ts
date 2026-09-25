import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1615: routes/pages now run inside withPinnedConnection (via withApiRoute /
// withTenantScope). In unit tests there is no real pool, so stub the primitive
// to run the callback directly (matches tests/unit/auth-middleware-require-auth.test.ts).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));


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

  // #1987: the JSON path streams row-chunks but must emit bytes identical
  // to the previous NextResponse.json({ data, meta }) shape.
  describe('POST json export (streamed, #1987)', () => {
    beforeEach(() => {
      vi.doMock('@/lib/api/validate', () => ({
        readJsonBody: vi.fn().mockResolvedValue({ entity: 'contacts', format: 'json' }),
      }));
    });

    it('parses back to { data, meta } with the expected keys', async () => {
      const rows = [
        { id: '1', firstName: 'Ada' },
        { id: '2', firstName: 'Grace' },
      ];
      mockDbRows(rows);

      const { POST } = await import('@/app/api/tenant/export/route');
      const req = new Request('http://localhost:3000/api/tenant/export', { method: 'POST' });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');

      const body = await res.json();
      expect(body.data).toEqual(rows);
      expect(body.meta.entity).toBe('contacts');
      expect(body.meta.total).toBe(2);
      expect(body.meta.format).toBe('json');
      expect(typeof body.meta.exported_at).toBe('string');
    });

    it('streams chunk boundaries byte-identically to JSON.stringify', async () => {
      // 600 rows spans multiple 250-row chunks (250+250+100) to prove the
      // comma placement between chunks matches a single stringify call.
      const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i), firstName: `F${i}` }));
      mockDbRows(rows);

      const { POST } = await import('@/app/api/tenant/export/route');
      const req = new Request('http://localhost:3000/api/tenant/export', { method: 'POST' });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      const text = await res.text();

      const parsed = JSON.parse(text);
      expect(parsed.data.length).toBe(600);
      expect(parsed.meta.total).toBe(600);
      // Exact prefix/suffix: no stray commas around chunk joins.
      expect(text.startsWith('{"data":[{"id":"0","firstName":"F0"},{"id":"1"')).toBe(true);
      expect(text.endsWith('"format":"json"}}')).toBe(true);
      expect(parsed.data[249]).toEqual({ id: '249', firstName: 'F249' });
      expect(parsed.data[500]).toEqual({ id: '500', firstName: 'F500' });
    });

    it('emits an empty data array for zero rows', async () => {
      mockDbRows([]);

      const { POST } = await import('@/app/api/tenant/export/route');
      const req = new Request('http://localhost:3000/api/tenant/export', { method: 'POST' });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      const text = await res.text();

      expect(text.startsWith('{"data":[],"meta":')).toBe(true);
      expect(JSON.parse(text).data).toEqual([]);
    });
  });
});

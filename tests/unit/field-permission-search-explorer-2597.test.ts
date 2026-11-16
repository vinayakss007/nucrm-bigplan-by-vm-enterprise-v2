/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';

const { mockDb, mockEnforceFieldRead, mockEnforceFieldWrite } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    execute: vi.fn(),
  },
  mockEnforceFieldRead: vi.fn(),
  mockEnforceFieldWrite: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'user-1',
    roleSlug: 'rep',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));

vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: mockEnforceFieldRead,
  enforceFieldWrite: mockEnforceFieldWrite,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/api/read-rate-limit', () => ({
  rateLimitRead: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
}));

function makeChain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'offset']) b[m] = chain;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return b;
}

describe('#2597 — Field-permission enforcement in Search & Data Explorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/search', () => {
    it('projects all returned entities through enforceFieldRead', async () => {
      const mockContacts = [{ id: 'c1', first_name: 'Alice', phone: '1234' }];
      const mockLeads = [{ id: 'l1', first_name: 'Bob', phone: '5678' }];
      const mockDeals = [{ id: 'd1', title: 'Deal 1', amount: '1000' }];
      const mockCompanies = [{ id: 'co1', name: 'Acme', phone: '9999' }];
      const mockTasks = [{ id: 't1', title: 'Task 1' }];

      mockDb.select
        .mockImplementationOnce(() => makeChain(mockContacts))
        .mockImplementationOnce(() => makeChain(mockLeads))
        .mockImplementationOnce(() => makeChain(mockDeals))
        .mockImplementationOnce(() => makeChain(mockCompanies))
        .mockImplementationOnce(() => makeChain(mockTasks));

      // Mock enforceFieldRead projecting out phone and amount
      mockEnforceFieldRead.mockImplementation(async (_ctx, entity, rows) => {
        if (entity === 'deals') {
          return rows.map(({ amount: _a, ...rest }: Record<string, unknown>) => rest);
        }
        if (entity === 'contacts') {
          return rows.map(({ phone: _p, ...rest }: Record<string, unknown>) => rest);
        }
        return rows;
      });

      const { GET } = await import('@/app/api/tenant/search/route');
      const req = new NextRequest('http://localhost/api/tenant/search?q=test');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'contacts', mockContacts);
      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'leads', mockLeads);
      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'deals', mockDeals);
      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'companies', mockCompanies);
      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'tasks', mockTasks);

      expect(json.deals[0]).not.toHaveProperty('amount');
      expect(json.contacts[0]).not.toHaveProperty('phone');
      expect(json.total).toBe(5);
    });
  });

  describe('POST /api/tenant/search/advanced', () => {
    it('projects results through enforceFieldRead for the selected type', async () => {
      const mockDeals = [
        { id: 'd1', title: 'Deal 1', amount: 1000, stageId: 's1', pipelineId: 'p1', createdAt: new Date() },
      ];

      mockDb.select
        .mockImplementationOnce(() => makeChain(mockDeals))
        .mockImplementationOnce(() => makeChain([{ count: 1 }]));

      mockEnforceFieldRead.mockImplementation(async (_ctx, _entity, rows) => {
        return rows.map(({ amount: _a, ...rest }: Record<string, unknown>) => rest);
      });

      const { POST } = await import('@/app/api/tenant/search/advanced/route');
      const req = new NextRequest('http://localhost/api/tenant/search/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'deals',
          filters: [],
        }),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'deals', expect.any(Array));
      expect(json.data[0]).not.toHaveProperty('amount');
    });
  });

  describe('Data Explorer field permissions (GET & PUT)', () => {
    it('GET /api/tenant/data-explorer projects rows through enforceFieldRead', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: '1', first_name: 'Alice', phone: '123-456' }],
          rowCount: 1,
        });

      mockEnforceFieldRead.mockImplementation(async (_ctx, _entity, rows) => {
        return rows.map(({ phone: _p, ...rest }: Record<string, unknown>) => rest);
      });

      const { GET } = await import('@/app/api/tenant/data-explorer/route');
      const req = new NextRequest('http://localhost/api/tenant/data-explorer?type=contacts');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(mockEnforceFieldRead).toHaveBeenCalledWith(expect.anything(), 'contacts', expect.any(Array));
      expect(json.data[0]).not.toHaveProperty('phone');
    });

    it('PUT /api/tenant/data-explorer returns 403 when enforceFieldWrite strips the target field', async () => {
      mockEnforceFieldWrite.mockResolvedValueOnce({
        body: {},
        stripped: ['phone'],
      });

      const { PUT } = await import('@/app/api/tenant/data-explorer/route');
      const req = new NextRequest('http://localhost/api/tenant/data-explorer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'contacts',
          id: '1',
          field: 'phone',
          value: '999-999',
        }),
      });
      const res = await PUT(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Field 'phone' is not editable for your role");
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('PUT /api/tenant/data-explorer allows update when field is not restricted', async () => {
      mockEnforceFieldWrite.mockResolvedValueOnce({
        body: { phone: '999-999' },
        stripped: [],
      });
      mockDb.execute.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });

      const { PUT } = await import('@/app/api/tenant/data-explorer/route');
      const req = new NextRequest('http://localhost/api/tenant/data-explorer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'contacts',
          id: '1',
          field: 'phone',
          value: '999-999',
        }),
      });
      const res = await PUT(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });
});

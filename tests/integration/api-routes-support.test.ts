import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest, requireAuthContext } from '../helpers/auth-mock';
import { mockDb, mockResolver } from '../helpers/db-mock';

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => requireAuthContext()),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

describe('Support routes', () => {
  beforeEach(() => {
    mockResolver();
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/tickets', () => {
    it('returns paginated tickets', async () => {
      const route = (await import('@/app/api/tenant/tickets/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  describe('POST /api/tenant/tickets', () => {
    it('creates ticket with required fields', async () => {
      const route = (await import('@/app/api/tenant/tickets/route')).POST;
      const res = await route(createTestRequest('/api/tenant/tickets', {
        method: 'POST',
        body: {
          subject: 'Test ticket',
          description: 'Description here',
          contact_id: '550e8400-e29b-41d4-a716-446655440000',
          assigned_to: '550e8400-e29b-41d4-a716-446655440001',
          priority: 'medium',
          status: 'open',
        },
      }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/tenant/sla', () => {
    it('returns SLA policies', async () => {
      const route = (await import('@/app/api/tenant/sla/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/sla', () => {
    it('creates SLA policy', async () => {
      const route = (await import('@/app/api/tenant/sla/route')).POST;
      const res = await route(createTestRequest('/api/tenant/sla', {
        method: 'POST',
        body: {
          name: 'Premium SLA',
          priority: 'high',
          responseTimeMinutes: 60,
          resolutionTimeMinutes: 240,
        },
      }));
      expect(res.status).toBe(201);
    });
  });

  describe('PUT /api/tenant/sla', () => {
    it('updates SLA policy', async () => {
      const route = (await import('@/app/api/tenant/sla/route')).PUT;
      const res = await route(createTestRequest('/api/tenant/sla', {
        method: 'PUT',
        body: {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Updated SLA',
        },
      }));
      expect(res.status).toBe(200);
    });
  });
});

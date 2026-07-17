import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest, requireAuthContext } from '../helpers/auth-mock';
import { mockDb, mockResolver } from '../helpers/db-mock';

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => requireAuthContext()),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn().mockResolvedValue(null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/ai/plan-gate', () => ({
  requireAiFeature: vi.fn().mockResolvedValue(null),
}));

/** Restore default mock chains so tests don't leak state to each other */
function restoreMockChains() {
  mockDb.select.mockReturnValue(mockDb);
  mockDb.update.mockReturnValue(mockDb);
  mockDb.delete.mockReturnValue(mockDb);
}

describe('Lead Warming routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolver();       // reset the default resolver to return []
    restoreMockChains();  // reset mock chains to default thenable
  });

  // ── Campaigns ──────────────────────────────────────────────────────

  describe('GET /api/tenant/lead-warming/campaigns', () => {
    it('returns campaign list', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it('filters by status', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns', {
        searchParams: { status: 'active' },
      }));
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/lead-warming/campaigns', () => {
    it('creates campaign with name', async () => {
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'mock-id', name: 'Diwali 2026', status: 'draft' }]),
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns', {
        method: 'POST',
        body: { name: 'Diwali 2026', description: 'Warm Diwali greetings' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data.name).toBe('Diwali 2026');
    });

    it('returns 400 without name', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns', {
        method: 'POST',
        body: { description: 'No name' },
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/name/i);
    });

    it('rejects blank name', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns', {
        method: 'POST',
        body: { name: '   ' },
      }));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tenant/lead-warming/campaigns/[id]', () => {
    it('returns 404 for unknown campaign', async () => {
      mockResolver(null);
      const route = (await import('@/app/api/tenant/lead-warming/campaigns/[id]/route')).GET;
      const res = await route(
        createTestRequest('/api/tenant/lead-warming/campaigns/cam-xxx'),
        { params: Promise.resolve({ id: 'cam-xxx' }) },
      );
      expect(res.status).toBe(404);
    });

    it('returns campaign detail', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([{ id: 'cam-1', name: 'Test Campaign', status: 'active' }]),
          };
        }
        if (callCount === 2) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
          };
        }
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockResolvedValue([]),
        };
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/[id]/route')).GET;
      const res = await route(
        createTestRequest('/api/tenant/lead-warming/campaigns/cam-1'),
        { params: Promise.resolve({ id: 'cam-1' }) },
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.name).toBe('Test Campaign');
    });
  });

  describe('PATCH /api/tenant/lead-warming/campaigns/[id]', () => {
    it('updates campaign status', async () => {
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'cam-1', name: 'Test', status: 'paused' }]),
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/[id]/route')).PATCH;
      const res = await route(
        createTestRequest('/api/tenant/lead-warming/campaigns/cam-1', {
          method: 'PATCH',
          body: { status: 'paused' },
        }),
        { params: Promise.resolve({ id: 'cam-1' }) },
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('returns 404 for unknown campaign', async () => {
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/[id]/route')).PATCH;
      const res = await route(
        createTestRequest('/api/tenant/lead-warming/campaigns/cam-xxx', {
          method: 'PATCH',
          body: { status: 'active' },
        }),
        { params: Promise.resolve({ id: 'cam-xxx' }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/tenant/lead-warming/campaigns/[id]', () => {
    it('archives campaign', async () => {
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/[id]/route')).DELETE;
      const res = await route(
        createTestRequest('/api/tenant/lead-warming/campaigns/cam-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'cam-1' }) },
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });

  // ── Events ─────────────────────────────────────────────────────────

  describe('GET /api/tenant/lead-warming/events', () => {
    it('returns events list', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/events/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/events'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });
  });

  describe('POST /api/tenant/lead-warming/events', () => {
    it('creates custom event', async () => {
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{
          id: 'evt-1', name: 'Company Anniversary',
          event_month: 6, event_day: 15, event_type: 'custom',
        }]),
      });

      const route = (await import('@/app/api/tenant/lead-warming/events/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/events', {
        method: 'POST',
        body: {
          name: 'Company Anniversary',
          event_month: 6,
          event_day: 15,
          event_type: 'custom',
          channels: ['email'],
        },
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data.name).toBe('Company Anniversary');
    });

    it('returns 400 without name', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/events/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/events', {
        method: 'POST',
        body: { event_month: 6, event_day: 15 },
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 without month/day', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/events/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/events', {
        method: 'POST',
        body: { name: 'Test Event' },
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/event_month|event_day/i);
    });
  });

  // ── Stats ──────────────────────────────────────────────────────────

  describe('GET /api/tenant/lead-warming/stats', () => {
    it('returns stats with all fields', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ total: 5, active: 2 }]),
          };
        }
        if (callCount === 2) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{
              total: 100, sent: 80, queued: 10, failed: 5,
              emailCount: 60, whatsappCount: 20,
            }]),
          };
        }
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{
            total: 25, interested: 10, notInterested: 5,
            askLater: 3, question: 4, positiveSocial: 2, unsubscribe: 1,
          }]),
        };
      });

      const route = (await import('@/app/api/tenant/lead-warming/stats/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/stats'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.campaigns.total).toBe(5);
      expect(data.messages.sent).toBe(80);
      expect(data.replies.interested).toBe(10);
      expect(data.replies.replyRate).toBeGreaterThan(0);
    });

    it('handles zero counts gracefully', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ total: 0, active: 0 }]),
      }));

      const route = (await import('@/app/api/tenant/lead-warming/stats/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/stats'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.replies.replyRate).toBe(0);
    });
  });

  // ── Replies ────────────────────────────────────────────────────────

  describe('GET /api/tenant/lead-warming/replies', () => {
    it('returns replies list', async () => {
      const route = (await import('@/app/api/tenant/lead-warming/replies/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/replies'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('data');
    });
  });

  // ── Permission denied ──────────────────────────────────────────────

  describe('Permission checks', () => {
    it('returns 403 when automations.view denied', async () => {
      const { can } = await import('@/lib/auth/middleware');
      (can as ReturnType<typeof vi.fn>).mockImplementation((_ctx: unknown, perm: string) => {
        if (perm === 'automations.view') return false;
        return true;
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns'));
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/permission/i);

      (can as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it('returns 403 when automations.manage denied on POST', async () => {
      const { can } = await import('@/lib/auth/middleware');
      (can as ReturnType<typeof vi.fn>).mockImplementation((_ctx: unknown, perm: string) => {
        if (perm === 'automations.manage') return false;
        return true;
      });

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).POST;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns', {
        method: 'POST',
        body: { name: 'Test' },
      }));
      expect(res.status).toBe(403);

      (can as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });
  });

  // ── AI Feature Gate ────────────────────────────────────────────────

  describe('AI Feature Gate', () => {
    it('returns 403 when lead warming feature unavailable', async () => {
      const { requireAiFeature } = await import('@/lib/ai/plan-gate');
      (requireAiFeature as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Feature not available' }), { status: 403 }),
      );

      const route = (await import('@/app/api/tenant/lead-warming/campaigns/route')).GET;
      const res = await route(createTestRequest('/api/tenant/lead-warming/campaigns'));
      expect(res.status).toBe(403);

      (requireAiFeature as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    });
  });
});

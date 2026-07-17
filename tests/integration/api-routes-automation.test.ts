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
vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/automation/workflows', () => ({
  getAllWorkflows: vi.fn().mockReturnValue([
    { id: 'wf-1', name: 'Welcome Series', description: 'Onboard new leads' },
    { id: 'wf-2', name: 'Re-engagement', description: 'Re-engage inactive leads' },
  ]),
}));

describe('Automation routes', () => {
  beforeEach(() => {
    mockResolver();
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/automation/workflows', () => {
    it('returns workflow list', async () => {
      const route = (await import('@/app/api/tenant/automation/workflows/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeInstanceOf(Array);
    });
  });

  describe('PATCH /api/tenant/automation/workflows', () => {
    it('enables workflow', async () => {
      const route = (await import('@/app/api/tenant/automation/workflows/route')).PATCH;
      const res = await route(createTestRequest('/api/tenant/automation/workflows', {
        method: 'PATCH',
        body: {
          workflow_id: 'wf-1',
          enabled: true,
        },
      }));
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown workflow', async () => {
      const route = (await import('@/app/api/tenant/automation/workflows/route')).PATCH;
      const res = await route(createTestRequest('/api/tenant/automation/workflows', {
        method: 'PATCH',
        body: {
          workflow_id: 'wf-nonexistent',
          enabled: true,
        },
      }));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/tenant/sequences', () => {
    it('returns sequence list', async () => {
      const route = (await import('@/app/api/tenant/sequences/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });
  });

  describe('POST /api/tenant/sequences', () => {
    it('creates sequence', async () => {
      const route = (await import('@/app/api/tenant/sequences/route')).POST;
      const res = await route(createTestRequest('/api/tenant/sequences', {
        method: 'POST',
        body: {
          name: 'Lead Nurture',
          description: 'Nurture sequence',
          steps: [
            { type: 'email', subject: 'Welcome', body: 'Hi!', delay_minutes: 0 },
            { type: 'email', subject: 'Follow up', body: 'Checking in', delay_minutes: 1440 },
          ],
        },
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });
});

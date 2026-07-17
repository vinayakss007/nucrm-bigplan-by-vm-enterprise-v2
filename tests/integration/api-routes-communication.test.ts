import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest, requireAuthContext } from '../helpers/auth-mock';
import { mockDb, mockResolver } from '../helpers/db-mock';

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => requireAuthContext()),
  requirePerm: vi.fn(() => null),
}));
vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));

describe('Communication routes', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolver();
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/email-templates', () => {
    it('returns email templates', async () => {
      const route = (await import('@/app/api/tenant/email-templates/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });
  });

  describe('POST /api/tenant/email-templates', () => {
    it('creates email template', async () => {
      const route = (await import('@/app/api/tenant/email-templates/route')).POST;
      const res = await route(createTestRequest('/api/tenant/email-templates', {
        method: 'POST',
        body: {
          name: 'Welcome',
          subject: 'Welcome!',
          body: '<h1>Hello</h1>',
        },
      }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/tenant/sms', () => {
    it('returns paginated SMS messages', async () => {
      mockResolver(() => [{ count: 0 }]);
      const route = (await import('@/app/api/tenant/sms/route')).GET;
      const res = await route(createTestRequest('GET'));
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/sms', () => {
    it('sends SMS when module active', async () => {
      vi.doMock('@/lib/sms', () => ({
        sendSMS: vi.fn().mockResolvedValue({ success: true }),
      }));
      const route = (await import('@/app/api/tenant/sms/route')).POST;
      const res = await route(createTestRequest('/api/tenant/sms', {
        method: 'POST',
        body: {
          to: '+1234567890',
          body: 'Hello!',
        },
      }));
      expect(res.status).toBe(201);
    });
  });
});

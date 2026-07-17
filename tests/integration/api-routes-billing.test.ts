import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest, requireAuthContext } from '../helpers/auth-mock';
import { mockDb, mockResolver } from '../helpers/db-mock';

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => requireAuthContext()),
  requirePerm: vi.fn(() => null),
}));

describe('Billing routes', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolver();
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/billing/checkout (portal)', () => {
    it('returns 503 when Stripe not configured', async () => {
      vi.doMock('@/lib/stripe', () => ({
        isStripeConfigured: () => false,
      }));
      const route = (await import('@/app/api/tenant/billing/checkout/route')).GET;
      const res = await route(createTestRequest('/api/tenant/billing/checkout'));
      expect(res.status).toBe(503);
    });
  });

  describe('POST /api/tenant/billing/checkout', () => {
    it('creates checkout session when configured', async () => {
      vi.doMock('@/lib/stripe', () => ({
        isStripeConfigured: () => true,
        createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test', id: 'cs_test' }),
        getPriceId: vi.fn().mockReturnValue('price_test'),
      }));
      const route = (await import('@/app/api/tenant/billing/checkout/route')).POST;
      const res = await route(createTestRequest('/api/tenant/billing/checkout', {
        method: 'POST',
        body: { plan: 'pro', interval: 'month' },
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe('https://checkout.stripe.com/test');
    });
  });

  describe('GET /api/tenant/invoices', () => {
    it('returns paginated invoices', async () => {
      const route = (await import('@/app/api/tenant/invoices/route')).GET;
      const res = await route(createTestRequest('/api/tenant/invoices'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.invoices).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  describe('GET /api/tenant/subscriptions', () => {
    it('returns paginated subscriptions', async () => {
      const route = (await import('@/app/api/tenant/subscriptions/route')).GET;
      const res = await route(createTestRequest('/api/tenant/subscriptions'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.subscriptions).toEqual([]);
      expect(data.total).toBe(0);
    });
  });
});

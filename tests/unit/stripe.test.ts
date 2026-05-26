import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn() })) })),
    select: vi.fn(),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    query: {},
  },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: {},
  tenantModules: {},
}));

vi.mock('@/drizzle/schema/infra', () => ({
  billingEvents: {},
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: { id: 'id', stripeCustomerId: 'stripe_customer_id' },
  plans: {},
}));

describe('Stripe Helpers', () => {
  const originalEnv = process.env;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: 'sk_test_123' };
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('getStripeHeaders', () => {
    it('returns correct headers with API key', async () => {
      const { getStripeHeaders } = await import('@/lib/stripe');
      const headers = getStripeHeaders();
      expect(headers.Authorization).toBe('Bearer sk_test_123');
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('throws if STRIPE_SECRET_KEY is not set', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      // Need fresh import
      vi.resetModules();
      const { getStripeHeaders } = await import('@/lib/stripe');
      expect(() => getStripeHeaders()).toThrow('STRIPE_SECRET_KEY is not configured');
    });
  });

  describe('createCheckoutSession', () => {
    it('calls Stripe API and returns session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/test' }),
      });

      const { createCheckoutSession } = await import('@/lib/stripe');
      const result = await createCheckoutSession('tenant-1', 'Pro', 2900);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(options.method).toBe('POST');
      expect(result.id).toBe('cs_test_123');
      expect(result.url).toBe('https://checkout.stripe.com/test');
    });

    it('throws on Stripe error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Invalid currency' } }),
      });

      const { createCheckoutSession } = await import('@/lib/stripe');
      await expect(createCheckoutSession('tenant-1', 'Pro', 2900)).rejects.toThrow('Invalid currency');
    });

    it('includes customer ID when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_test_456', url: 'https://checkout.stripe.com/test2' }),
      });

      const { createCheckoutSession } = await import('@/lib/stripe');
      await createCheckoutSession('tenant-1', 'Pro', 2900, { customerId: 'cus_123' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = (options.body as string) ?? '';
      expect(body).toContain('customer=cus_123');
    });
  });

  describe('createPortalSession', () => {
    it('calls Stripe billing portal API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://billing.stripe.com/session/test' }),
      });

      const { createPortalSession } = await import('@/lib/stripe');
      const result = await createPortalSession('cus_test_123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
      expect(result.url).toBe('https://billing.stripe.com/session/test');
    });

    it('throws on Stripe error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Customer not found' } }),
      });

      const { createPortalSession } = await import('@/lib/stripe');
      await expect(createPortalSession('cus_invalid')).rejects.toThrow('Customer not found');
    });
  });

  describe('createModuleCheckoutSession', () => {
    it('creates checkout for module add-on', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_mod_123', url: 'https://checkout.stripe.com/module' }),
      });

      const { createModuleCheckoutSession } = await import('@/lib/stripe');
      const result = await createModuleCheckoutSession('tenant-1', 'whatsapp-bot', 'WhatsApp Automation', 1900);

      expect(result.id).toBe('cs_mod_123');
      expect(result.url).toBe('https://checkout.stripe.com/module');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = (options.body as string) ?? '';
      expect(body).toContain('module_id');
      expect(body).toContain('module_addon');
    });
  });

  describe('constructWebhookEvent', () => {
    it('successfully verifies and parses a valid webhook event', async () => {
      const { constructWebhookEvent } = await import('@/lib/stripe');

      const secret = 'whsec_test_secret_key';
      const payload = JSON.stringify({
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123', metadata: { tenant_id: 'tenant-1' } } },
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      const sigHeader = `t=${timestamp},v1=${signature}`;

      const event = constructWebhookEvent(payload, sigHeader, secret);
      expect(event.id).toBe('evt_123');
      expect(event.type).toBe('checkout.session.completed');
      expect(event.data.object['id']).toBe('cs_123');
    });

    it('rejects invalid signature', async () => {
      const { constructWebhookEvent } = await import('@/lib/stripe');

      const payload = JSON.stringify({ id: 'evt_123', type: 'test', data: { object: {} } });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sigHeader = `t=${timestamp},v1=invalidsignature0000000000000000000000000000000000000000000000000`;

      expect(() => constructWebhookEvent(payload, sigHeader, 'whsec_secret')).toThrow('signature verification failed');
    });

    it('rejects missing signature parts', async () => {
      const { constructWebhookEvent } = await import('@/lib/stripe');

      const payload = JSON.stringify({ id: 'evt_123', type: 'test', data: { object: {} } });

      expect(() => constructWebhookEvent(payload, 'invalid_format', 'whsec_secret')).toThrow('Invalid Stripe webhook signature format');
    });

    it('rejects expired timestamp', async () => {
      const { constructWebhookEvent } = await import('@/lib/stripe');

      const secret = 'whsec_test_secret';
      const payload = JSON.stringify({ id: 'evt_123', type: 'test', data: { object: {} } });
      // Timestamp 10 minutes ago
      const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      const sigHeader = `t=${timestamp},v1=${signature}`;

      expect(() => constructWebhookEvent(payload, sigHeader, secret)).toThrow('timestamp is too old');
    });
  });

  describe('cancelSubscription', () => {
    it('calls Stripe DELETE endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'sub_123', status: 'canceled' }),
      });

      const { cancelSubscription } = await import('@/lib/stripe');
      const result = await cancelSubscription('sub_123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
      expect(options.method).toBe('DELETE');
      expect(result['status']).toBe('canceled');
    });

    it('throws on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Subscription not found' } }),
      });

      const { cancelSubscription } = await import('@/lib/stripe');
      await expect(cancelSubscription('sub_invalid')).rejects.toThrow('Subscription not found');
    });
  });

  describe('updateSubscription', () => {
    it('calls Stripe POST endpoint with params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'sub_123', status: 'active' }),
      });

      const { updateSubscription } = await import('@/lib/stripe');
      const result = await updateSubscription('sub_123', { cancel_at_period_end: 'true' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
      expect(options.method).toBe('POST');
      const body = (options.body as string) ?? '';
      expect(body).toContain('cancel_at_period_end=true');
      expect(result['status']).toBe('active');
    });
  });
});

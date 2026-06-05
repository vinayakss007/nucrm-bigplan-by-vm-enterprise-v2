/**
 * Stripe Integration Tests
 *
 * Tests the Stripe utility functions without hitting real Stripe APIs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockStripeEnv, clearStripeEnv, mockStripeFetch } from '../helpers/stripe-mock';

describe('lib/stripe', () => {
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    mockStripeEnv();
    vi.resetModules();
  });

  afterEach(() => {
    clearStripeEnv();
    if (restoreFetch) restoreFetch();
  });

  describe('isStripeConfigured', () => {
    it('returns true when both keys are set', async () => {
      const { isStripeConfigured } = await import('@/lib/stripe');
      expect(isStripeConfigured()).toBe(true);
    });

    it('returns false when STRIPE_SECRET_KEY is missing', async () => {
      delete process.env['STRIPE_SECRET_KEY'];
      const { isStripeConfigured } = await import('@/lib/stripe');
      expect(isStripeConfigured()).toBe(false);
    });

    it('returns false when STRIPE_WEBHOOK_SECRET is missing', async () => {
      delete process.env['STRIPE_WEBHOOK_SECRET'];
      const { isStripeConfigured } = await import('@/lib/stripe');
      expect(isStripeConfigured()).toBe(false);
    });
  });

  describe('getPriceId', () => {
    it('returns correct price for starter monthly', async () => {
      const { getPriceId } = await import('@/lib/stripe');
      expect(getPriceId('starter', 'month')).toBe('price_starter_monthly');
    });

    it('returns correct price for pro monthly', async () => {
      const { getPriceId } = await import('@/lib/stripe');
      expect(getPriceId('pro', 'month')).toBe('price_pro_monthly');
    });

    it('returns null for free plan', async () => {
      const { getPriceId } = await import('@/lib/stripe');
      expect(getPriceId('free', 'month')).toBeNull();
    });

    it('returns null for unconfigured interval', async () => {
      const { getPriceId } = await import('@/lib/stripe');
      expect(getPriceId('starter', 'year')).toBeNull();
    });
  });

  describe('createCustomer', () => {
    it('calls Stripe API with correct params', async () => {
      restoreFetch = mockStripeFetch();
      const { createCustomer } = await import('@/lib/stripe');

      const result = await createCustomer({
        email: 'test@example.com',
        name: 'Test Corp',
        tenantId: 'tenant-123',
      });

      expect(result).toHaveProperty('id');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/customers'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('createCheckoutSession', () => {
    it('creates a checkout session with subscription mode', async () => {
      restoreFetch = mockStripeFetch();
      const { createCheckoutSession } = await import('@/lib/stripe');

      const result = await createCheckoutSession({
        tenantId: 'tenant-123',
        customerEmail: 'user@test.com',
        priceId: 'price_starter_monthly',
        mode: 'subscription',
      });

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('id');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkout/sessions'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('includes trial_period_days when specified', async () => {
      restoreFetch = mockStripeFetch();
      const { createCheckoutSession } = await import('@/lib/stripe');

      await createCheckoutSession({
        tenantId: 'tenant-123',
        customerEmail: 'user@test.com',
        priceId: 'price_pro_monthly',
        mode: 'subscription',
        trialDays: 14,
      });

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body;
      expect(body).toContain('subscription_data');
      expect(body).toContain('trial_period_days');
    });
  });

  describe('cancelSubscription', () => {
    it('cancels at period end by default', async () => {
      restoreFetch = mockStripeFetch();
      const { cancelSubscription } = await import('@/lib/stripe');

      const result = await cancelSubscription('sub_123');

      expect(result).toHaveProperty('id');
      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].body).toContain('cancel_at_period_end');
    });

    it('immediately cancels when atPeriodEnd is false', async () => {
      restoreFetch = mockStripeFetch();
      const { cancelSubscription } = await import('@/lib/stripe');

      await cancelSubscription('sub_123', false);

      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].method).toBe('DELETE');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('rejects invalid signature format', async () => {
      const { verifyWebhookSignature } = await import('@/lib/stripe');

      await expect(
        verifyWebhookSignature('{}', 'invalid-signature')
      ).rejects.toThrow('Invalid webhook signature format');
    });

    it('rejects old timestamps', async () => {
      const { verifyWebhookSignature } = await import('@/lib/stripe');
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago

      await expect(
        verifyWebhookSignature('{}', `t=${oldTimestamp},v1=fakesig`)
      ).rejects.toThrow('Webhook timestamp too old');
    });
  });

  describe('createPortalSession', () => {
    it('creates portal session with return URL', async () => {
      restoreFetch = mockStripeFetch();
      const { createPortalSession } = await import('@/lib/stripe');

      const result = await createPortalSession('cus_123');

      expect(result).toHaveProperty('url');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/billing_portal/sessions'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('StripeError', () => {
    it('creates error with code and status', async () => {
      const { StripeError } = await import('@/lib/stripe');
      const err = new StripeError('Card declined', 'card_declined', 402);

      expect(err.message).toBe('Card declined');
      expect(err.code).toBe('card_declined');
      expect(err.statusCode).toBe(402);
      expect(err.name).toBe('StripeError');
    });
  });
});

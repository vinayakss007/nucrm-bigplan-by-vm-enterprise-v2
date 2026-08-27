/**
 * Razorpay Integration Tests
 *
 * Tests the Razorpay utility functions without hitting real Razorpay APIs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockRazorpayEnv, clearRazorpayEnv, mockRazorpayFetch } from '../helpers/razorpay-mock';

describe('lib/razorpay', () => {
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    mockRazorpayEnv();
    vi.resetModules();
  });

  afterEach(() => {
    clearRazorpayEnv();
    if (restoreFetch) restoreFetch();
  });

  describe('isRazorpayConfigured', () => {
    it('returns true when both keys are set', async () => {
      const { isRazorpayConfigured } = await import('@/lib/razorpay');
      expect(isRazorpayConfigured()).toBe(true);
    });

    it('returns false when RAZORPAY_KEY_ID is missing', async () => {
      delete process.env['RAZORPAY_KEY_ID'];
      const { isRazorpayConfigured } = await import('@/lib/razorpay');
      expect(isRazorpayConfigured()).toBe(false);
    });

    it('returns false when RAZORPAY_KEY_SECRET is missing', async () => {
      delete process.env['RAZORPAY_KEY_SECRET'];
      const { isRazorpayConfigured } = await import('@/lib/razorpay');
      expect(isRazorpayConfigured()).toBe(false);
    });
  });

  describe('getPlanAmount', () => {
    it('returns correct amount for starter monthly', async () => {
      const { getPlanAmount } = await import('@/lib/razorpay');
      expect(getPlanAmount('starter', 'month')).toBe(149900);
    });

    it('returns correct amount for starter yearly', async () => {
      const { getPlanAmount } = await import('@/lib/razorpay');
      expect(getPlanAmount('starter', 'year')).toBe(1439000);
    });

    it('returns correct amount for growth monthly', async () => {
      const { getPlanAmount } = await import('@/lib/razorpay');
      expect(getPlanAmount('growth', 'month')).toBe(299900);
    });

    it('returns correct amount for scale yearly', async () => {
      const { getPlanAmount } = await import('@/lib/razorpay');
      expect(getPlanAmount('scale', 'year')).toBe(5279000);
    });

    it('returns null for unknown plan', async () => {
      const { getPlanAmount } = await import('@/lib/razorpay');
      expect(getPlanAmount('unknown', 'month')).toBeNull();
    });
  });

  describe('normalizeRazorpayPlan (#1210)', () => {
    it('maps growth -> pro and scale -> enterprise', async () => {
      const { normalizeRazorpayPlan } = await import('@/lib/razorpay');
      expect(normalizeRazorpayPlan('growth')).toBe('pro');
      expect(normalizeRazorpayPlan('scale')).toBe('enterprise');
    });

    it('passes through canonical plan names unchanged', async () => {
      const { normalizeRazorpayPlan } = await import('@/lib/razorpay');
      expect(normalizeRazorpayPlan('starter')).toBe('starter');
      expect(normalizeRazorpayPlan('pro')).toBe('pro');
      expect(normalizeRazorpayPlan('enterprise')).toBe('enterprise');
    });

    it('defaults to starter when plan is missing', async () => {
      const { normalizeRazorpayPlan } = await import('@/lib/razorpay');
      expect(normalizeRazorpayPlan(undefined)).toBe('starter');
      expect(normalizeRazorpayPlan(null)).toBe('starter');
    });
  });

  describe('createOrder', () => {
    it('calls Razorpay API with correct params', async () => {
      restoreFetch = mockRazorpayFetch();
      const { createOrder } = await import('@/lib/razorpay');

      const result = await createOrder(149900, 'INR', 'receipt_123', { tenant_id: 'tenant-1' });

      expect(result).toHaveProperty('id');
      expect(result.id).toBe('order_mock123');
      expect(result.amount).toBe(149900);
      expect(result.currency).toBe('INR');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/orders'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('includes Basic auth header', async () => {
      restoreFetch = mockRazorpayFetch();
      const { createOrder } = await import('@/lib/razorpay');

      await createOrder(149900, 'INR', 'receipt_123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Basic /),
          }),
        }),
      );
    });

    it('throws RazorpayNotConfiguredError when keys are missing', async () => {
      clearRazorpayEnv();
      const { createOrder, RazorpayNotConfiguredError } = await import('@/lib/razorpay');

      await expect(createOrder(149900, 'INR', 'receipt_123'))
        .rejects.toThrow(RazorpayNotConfiguredError);
    });
  });

  describe('verifyPaymentSignature', () => {
    it('verifies a valid signature', async () => {
      const { verifyPaymentSignature } = await import('@/lib/razorpay');

      // Generate a valid signature using the mock secret
      const secret = 'mock_secret_456';
      const message = 'order_123|pay_456';
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
      const hexSig = Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const result = await verifyPaymentSignature('order_123', 'pay_456', hexSig);
      expect(result).toBe(true);
    });

    it('throws RazorpaySignatureError for invalid signature', async () => {
      const { verifyPaymentSignature, RazorpaySignatureError } = await import('@/lib/razorpay');

      await expect(
        verifyPaymentSignature('order_123', 'pay_456', 'invalid_signature_hex'),
      ).rejects.toThrow(RazorpaySignatureError);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('verifies a valid webhook signature', async () => {
      const { verifyWebhookSignature } = await import('@/lib/razorpay');

      const body = JSON.stringify({ event: 'payment.captured', payload: {} });
      const secret = 'whsec_mock_razorpay_789';

      // Generate valid HMAC
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const hexSig = Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const result = await verifyWebhookSignature(body, hexSig);
      expect(result).toBe(true);
    });

    it('throws RazorpaySignatureError for invalid webhook signature', async () => {
      const { verifyWebhookSignature, RazorpaySignatureError } = await import('@/lib/razorpay');

      await expect(
        verifyWebhookSignature('{"event":"test"}', 'bad_signature'),
      ).rejects.toThrow(RazorpaySignatureError);
    });

    it('throws when RAZORPAY_WEBHOOK_SECRET is not set', async () => {
      delete process.env['RAZORPAY_WEBHOOK_SECRET'];
      const { verifyWebhookSignature } = await import('@/lib/razorpay');

      await expect(
        verifyWebhookSignature('body', 'sig'),
      ).rejects.toThrow('RAZORPAY_WEBHOOK_SECRET is not configured');
    });
  });

  describe('createSubscription', () => {
    it('calls Razorpay subscription API', async () => {
      restoreFetch = mockRazorpayFetch();
      const { createSubscription } = await import('@/lib/razorpay');

      const result = await createSubscription('plan_123', 'cust_456', { tenant_id: 'tenant-1' });

      expect(result).toHaveProperty('id');
      expect(result.id).toBe('sub_mock123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('cancelSubscription', () => {
    it('calls Razorpay cancel subscription API', async () => {
      restoreFetch = mockRazorpayFetch();
      const { cancelSubscription } = await import('@/lib/razorpay');

      const result = await cancelSubscription('sub_123');

      expect(result).toHaveProperty('status', 'cancelled');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions/sub_123/cancel'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('getPayment', () => {
    it('fetches payment details', async () => {
      restoreFetch = mockRazorpayFetch();
      const { getPayment } = await import('@/lib/razorpay');

      const result = await getPayment('pay_123');

      expect(result).toHaveProperty('id', 'pay_mock123');
      expect(result).toHaveProperty('currency', 'INR');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/payments/pay_123'),
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('createCustomer', () => {
    it('creates a Razorpay customer', async () => {
      restoreFetch = mockRazorpayFetch();
      const { createCustomer } = await import('@/lib/razorpay');

      const result = await createCustomer('Test User', 'test@example.com', '+919876543210');

      expect(result).toHaveProperty('id', 'cust_mock123');
      expect(result).toHaveProperty('email', 'test@example.com');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/customers'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws RazorpayApiError on API failure', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Invalid amount' } }),
          { status: 400 },
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

      const { createOrder, RazorpayApiError } = await import('@/lib/razorpay');

      await expect(createOrder(0, 'INR', 'receipt'))
        .rejects.toThrow(RazorpayApiError);

      global.fetch = originalFetch;
    });
  });
});

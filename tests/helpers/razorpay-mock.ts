/**
 * Razorpay Mock Helpers for Tests
 *
 * Mocks the Razorpay REST API calls without needing a real Razorpay account.
 */
import { vi } from 'vitest';

export function mockRazorpayEnv() {
  process.env['RAZORPAY_KEY_ID'] = 'rzp_test_mock_key_123';
  process.env['RAZORPAY_KEY_SECRET'] = 'mock_secret_456';
  process.env['RAZORPAY_WEBHOOK_SECRET'] = 'whsec_mock_razorpay_789';
}

export function clearRazorpayEnv() {
  delete process.env['RAZORPAY_KEY_ID'];
  delete process.env['RAZORPAY_KEY_SECRET'];
  delete process.env['RAZORPAY_WEBHOOK_SECRET'];
}

/**
 * Create a mock Razorpay webhook event payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockRazorpayWebhookEvent(event: string, payload: any = {}) {
  return {
    entity: 'event',
    event,
    payload,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Mock global fetch for Razorpay API calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockRazorpayFetch(responses: Record<string, any> = {}) {
  const originalFetch = global.fetch;

  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = url.toString();

    // Match Razorpay API calls
    if (urlStr.includes('api.razorpay.com')) {
      const endpoint = urlStr.replace('https://api.razorpay.com/v1', '');

      // Check for custom response
      for (const [pattern, response] of Object.entries(responses)) {
        if (endpoint.includes(pattern)) {
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Default responses
      if (endpoint.includes('/orders')) {
        return new Response(JSON.stringify({
          id: 'order_mock123',
          entity: 'order',
          amount: 149900,
          amount_paid: 0,
          amount_due: 149900,
          currency: 'INR',
          receipt: 'receipt_mock',
          status: 'created',
          notes: {},
          created_at: Math.floor(Date.now() / 1000),
        }), { status: 200 });
      }
      if (endpoint.includes('/subscriptions') && endpoint.includes('/cancel')) {
        return new Response(JSON.stringify({
          id: 'sub_mock123',
          entity: 'subscription',
          plan_id: 'plan_mock',
          customer_id: 'cust_mock',
          status: 'cancelled',
          current_start: null,
          current_end: null,
          notes: {},
        }), { status: 200 });
      }
      if (endpoint.includes('/subscriptions')) {
        return new Response(JSON.stringify({
          id: 'sub_mock123',
          entity: 'subscription',
          plan_id: 'plan_mock',
          customer_id: 'cust_mock',
          status: 'active',
          current_start: null,
          current_end: null,
          notes: {},
        }), { status: 200 });
      }
      if (endpoint.includes('/payments')) {
        return new Response(JSON.stringify({
          id: 'pay_mock123',
          entity: 'payment',
          amount: 149900,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_mock123',
          method: 'upi',
          description: null,
          email: 'test@example.com',
          contact: '+919876543210',
          notes: {},
          created_at: Math.floor(Date.now() / 1000),
        }), { status: 200 });
      }
      if (endpoint.includes('/customers')) {
        return new Response(JSON.stringify({
          id: 'cust_mock123',
          entity: 'customer',
          name: 'Test User',
          email: 'test@example.com',
          contact: '+919876543210',
          notes: {},
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ id: 'mock_default' }), { status: 200 });
    }

    // Pass through non-Razorpay requests
    return originalFetch(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return () => { global.fetch = originalFetch; };
}

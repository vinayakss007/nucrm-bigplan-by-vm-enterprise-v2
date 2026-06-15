/**
 * Stripe Mock Helpers for Tests
 *
 * Mocks the Stripe REST API calls without needing a real Stripe account.
 */
import { vi } from 'vitest';

export function mockStripeEnv() {
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock_key_123';
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock_secret_456';
  process.env['STRIPE_PRICE_STARTER_MONTHLY'] = 'price_starter_monthly';
  process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_monthly';
  process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'] = 'price_enterprise_monthly';
  process.env['NEXT_PUBLIC_APP_URL'] = 'http://localhost:3000';
}

export function clearStripeEnv() {
  delete process.env['STRIPE_SECRET_KEY'];
  delete process.env['STRIPE_WEBHOOK_SECRET'];
  delete process.env['STRIPE_PRICE_STARTER_MONTHLY'];
  delete process.env['STRIPE_PRICE_PRO_MONTHLY'];
  delete process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'];
}

/**
 * Create a mock Stripe webhook event payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockWebhookEvent(type: string, data: any = {}) {
  return {
    id: `evt_${Date.now()}`,
    type,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
  };
}

/**
 * Mock global fetch for Stripe API calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockStripeFetch(responses: Record<string, any> = {}) {
  const originalFetch = global.fetch;

  global.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();

    // Match Stripe API calls
    if (urlStr.includes('api.stripe.com')) {
      const endpoint = urlStr.replace('https://api.stripe.com/v1', '');

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
      if (endpoint.includes('/customers')) {
        return new Response(JSON.stringify({ id: 'cus_mock123', email: 'test@test.com' }), { status: 200 });
      }
      if (endpoint.includes('/checkout/sessions')) {
        return new Response(JSON.stringify({ id: 'cs_mock123', url: 'https://checkout.stripe.com/mock' }), { status: 200 });
      }
      if (endpoint.includes('/subscriptions')) {
        return new Response(JSON.stringify({ id: 'sub_mock123', status: 'active' }), { status: 200 });
      }
      if (endpoint.includes('/billing_portal/sessions')) {
        return new Response(JSON.stringify({ url: 'https://billing.stripe.com/mock' }), { status: 200 });
      }

      return new Response(JSON.stringify({ id: 'mock_default' }), { status: 200 });
    }

    // Pass through non-Stripe requests
    return originalFetch(url, options);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return () => { global.fetch = originalFetch; };
}

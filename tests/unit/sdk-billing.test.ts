import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestFn } from '@/lib/sdk/types';

describe('sdk/billing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('getCurrentPlan calls request with GET /billing/plan', async () => {
    mockRequest.mockResolvedValue({ id: 'plan-1', name: 'Pro', limits: {} });
    const { BillingSDK } = await import('@/lib/sdk/billing');
    const sdk = new BillingSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.getCurrentPlan();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/billing/plan');
    expect(result.name).toBe('Pro');
  });

  it('checkLimit calls request with GET /billing/limits/:resource', async () => {
    mockRequest.mockResolvedValue({ allowed: true, current: 5, limit: 100 });
    const { BillingSDK } = await import('@/lib/sdk/billing');
    const sdk = new BillingSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.checkLimit('contacts');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/billing/limits/contacts');
    expect(result.allowed).toBe(true);
  });

  it('getUsage calls request with GET /billing/usage', async () => {
    mockRequest.mockResolvedValue({ contacts: 10, deals: 5 });
    const { BillingSDK } = await import('@/lib/sdk/billing');
    const sdk = new BillingSDK(mockRequest as unknown as RequestFn);
    await sdk.getUsage();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/billing/usage');
  });

  it('requestUpgrade calls request with POST /billing/upgrade', async () => {
    mockRequest.mockResolvedValue({ url: 'https://checkout.stripe.com/...' });
    const { BillingSDK } = await import('@/lib/sdk/billing');
    const sdk = new BillingSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.requestUpgrade('plan-premium');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/billing/upgrade', { planId: 'plan-premium' });
    expect(result.url).toContain('stripe');
  });
});

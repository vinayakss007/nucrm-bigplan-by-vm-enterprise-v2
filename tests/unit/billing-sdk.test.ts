/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { BillingSDK } from '@/lib/sdk/billing';

function makeMockRequest(responses: Record<string, any> = {}) {
  return vi.fn(async (method: string, path: string, _body?: unknown) => {
    const key = `${method} ${path}`;
    if (key in responses) return responses[key];
    throw new Error(`Unexpected request: ${key}`);
  });
}

describe('BillingSDK', () => {
  it('getCurrentPlan calls GET /billing/plan', async () => {
    const mockData = { plan: 'pro', limits: { contacts: 10000 }, usage: { contacts: 500 } };
    const request = makeMockRequest({ 'GET /billing/plan': mockData });
    const sdk = new BillingSDK(request);
    const result = await sdk.getCurrentPlan();
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('GET', '/billing/plan');
  });

  it('checkLimit calls GET /billing/limits/{resource}', async () => {
    const mockData = { allowed: true, current: 5, max: 100 };
    const request = makeMockRequest({ 'GET /billing/limits/seats': mockData });
    const sdk = new BillingSDK(request);
    const result = await sdk.checkLimit('seats');
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('GET', '/billing/limits/seats');
  });

  it('getUsage calls GET /billing/usage', async () => {
    const mockData = { period: '2026-01', resources: { seats: { used: 5, limit: 10 } } };
    const request = makeMockRequest({ 'GET /billing/usage': mockData });
    const sdk = new BillingSDK(request);
    const result = await sdk.getUsage();
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('GET', '/billing/usage');
  });

  it('requestUpgrade calls POST /billing/upgrade with planId', async () => {
    const mockData = { url: 'https://checkout.stripe.com/xyz' };
    const request = makeMockRequest({ 'POST /billing/upgrade': mockData });
    const sdk = new BillingSDK(request);
    const result = await sdk.requestUpgrade('enterprise');
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('POST', '/billing/upgrade', { planId: 'enterprise' });
  });

  it('propagates errors from request function', async () => {
    const request = vi.fn(async () => { throw new Error('Network error'); });
    const sdk = new BillingSDK(request);
    await expect(sdk.getCurrentPlan()).rejects.toThrow('Network error');
  });

  it('handles different resource types in checkLimit', async () => {
    const request = makeMockRequest({
      'GET /billing/limits/api_calls': { allowed: false, current: 1000, max: 1000 },
      'GET /billing/limits/storage': { allowed: true, current: 50, max: 500 },
    });
    const sdk = new BillingSDK(request);
    const apiResult = await sdk.checkLimit('api_calls');
    expect(apiResult.allowed).toBe(false);
    const storageResult = await sdk.checkLimit('storage');
    expect(storageResult.allowed).toBe(true);
  });
});

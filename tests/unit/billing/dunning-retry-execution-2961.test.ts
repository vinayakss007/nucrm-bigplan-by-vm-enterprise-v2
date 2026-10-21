import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * #2961 — the manual dunning retry used to insert a 'pending' attempt that NO
 * worker ever drained, while returning success. The fix pays the subscription's
 * open invoice synchronously and settles the attempt to succeeded/failed.
 * These tests pin that execution path.
 */

const SUB_ID = '11111111-1111-4111-8111-111111111111';

const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn(async () => []);
const mockTopInsertValues = vi.fn(async () => []);
const mockTxInsertValuesData: unknown[] = [];
const mockTxSelectQueue: unknown[][] = [];

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(h: T) => h,
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: 'tenant-1', userId: 'user-1', isAdmin: true })),
}));

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn(() => true),
  getSubscription: vi.fn(async () => ({
    items: { data: [{ price: { unit_amount: 5000 } }] }, currency: 'usd',
  })),
  stripeFetch: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      subscriptions: {
        findFirst: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          tenantId: 'tenant-1',
          stripeSubscriptionId: 'sub_mock_1',
        })),
      },
      dunningSettings: { findFirst: vi.fn(async () => null) },
    },
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
      execute: vi.fn(async () => {}),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => mockTxSelectQueue.shift() ?? [{}]),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((v: unknown) => {
          mockTxInsertValuesData.push(v);
          return {
            returning: vi.fn(async () => [{ id: 'att-1', scheduledAt: new Date('2026-10-21') }]),
            then: (resolve: (r: unknown) => void) => resolve([]),
          };
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: (payload: unknown) => {
        mockUpdateSet(payload);
        return { where: mockUpdateWhere };
      },
    })),
    insert: vi.fn(() => ({ values: mockTopInsertValues })),
  },
}));

import { POST } from '@/app/api/tenant/billing/dunning/retry/route';
import { stripeFetch } from '@/lib/stripe';

const mockedStripeFetch = vi.mocked(stripeFetch);

function request() {
  return new Request('http://test/api/tenant/billing/dunning/retry', {
    method: 'POST',
    body: JSON.stringify({ subscriptionId: SUB_ID }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('dunning manual retry executes the payment (#2961)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxInsertValuesData.length = 0;
    mockTxSelectQueue.length = 0;
    mockTxSelectQueue.push([{ c: 0 }], [{ maxNum: 2 }]);
  });

  it('pays the open invoice and settles the attempt as succeeded', async () => {
    mockedStripeFetch
      .mockResolvedValueOnce({ data: [{ id: 'in_open1', status: 'open' }] })
      .mockResolvedValueOnce({ status: 'paid', payment_intent: 'pi_9' });

    const res = await POST(request() as never);
    expect(res).toBeInstanceOf(NextResponse);
    const body = await res.json();
    expect(body.data.status).toBe('succeeded');
    expect(body.data.attemptNumber).toBe(3);

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      stripeInvoiceId: 'in_open1',
      stripePaymentIntentId: 'pi_9',
      errorMessage: null,
    }));
    const settled = mockTopInsertValues.mock.calls.map(c => c[0]).find(
      (e) => (e as { eventType?: string }).eventType === 'dunning.retry_succeeded',
    );
    expect(settled).toBeDefined();
  });

  it('settles the attempt as failed with the Stripe error when payment is declined', async () => {
    mockedStripeFetch
      .mockResolvedValueOnce({ data: [{ id: 'in_open1', status: 'open' }] })
      .mockRejectedValueOnce(new Error('Your card was declined.'));

    const res = await POST(request() as never);
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.message).toContain('declined');

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorMessage: 'Your card was declined.',
    }));
  });

  it('fails honestly when there is no open invoice to retry', async () => {
    mockedStripeFetch.mockResolvedValueOnce({ data: [] });

    const res = await POST(request() as never);
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.error).toContain('No open invoice');
    // The attempt must never stay 'pending' — that is the bug #2961 reported.
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('never leaves a pending attempt behind on the success path', async () => {
    mockedStripeFetch
      .mockResolvedValueOnce({ data: [{ id: 'in_x', status: 'open' }] })
      .mockResolvedValueOnce({ status: 'paid' });
    await POST(request() as never);
    const statuses = mockUpdateSet.mock.calls.map(c => (c[0] as { status: string }).status);
    expect(statuses).not.toContain('pending');
  });
});

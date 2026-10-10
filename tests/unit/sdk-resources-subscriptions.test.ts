import { describe, it, expect, vi } from 'vitest';

describe('SubscriptionsResource', () => {
  it('list calls GET /subscriptions with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    await r.list({ page: 1, limit: 25, sort: 'createdAt', order: 'desc', search: 'test', filters: { status: 'active' } });
    expect(req).toHaveBeenCalledWith('GET', '/subscriptions', undefined, {
      page: '1',
      limit: '25',
      sort: 'createdAt',
      order: 'desc',
      search: 'test',
      filters: JSON.stringify({ status: 'active' }),
    });
  });

  it('list calls GET /subscriptions without params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', '/subscriptions', undefined, {});
  });

  it('get calls GET /subscriptions/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    expect(await r.get('s-1')).toEqual({ id: 's-1' });
    expect(req).toHaveBeenCalledWith('GET', '/subscriptions/s-1');
  });

  it('create calls POST /subscriptions with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-2' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    const data = { customerId: 'c-1', planId: 'p-1', status: 'active' as const, amount: 1000, currency: 'USD' };
    expect(await r.create(data)).toEqual({ id: 's-2' });
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions', data);
  });

  it('update calls PATCH /subscriptions/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1', status: 'paused' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    const result = await r.update('s-1', { status: 'paused' });
    expect(result.status).toBe('paused');
    expect(req).toHaveBeenCalledWith('PATCH', '/subscriptions/s-1', { status: 'paused' });
  });

  it('cancel calls POST /subscriptions/:id/cancel', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1', status: 'canceled' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    const result = await r.cancel('s-1');
    expect(result.status).toBe('canceled');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/s-1/cancel');
  });

  it('pause calls POST /subscriptions/:id/pause', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1', status: 'paused' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    const result = await r.pause('s-1');
    expect(result.status).toBe('paused');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/s-1/pause');
  });

  it('resume calls POST /subscriptions/:id/resume', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1', status: 'active' });
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const r = new SubscriptionsResource(req);
    const result = await r.resume('s-1');
    expect(result.status).toBe('active');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/s-1/resume');
  });
});

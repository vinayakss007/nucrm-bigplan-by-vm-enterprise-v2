import { describe, it, expect, vi } from 'vitest';

describe('ServicesResource', () => {
  it('list calls GET /services with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    await r.list({ page: 1, limit: 25, sort: 'name', order: 'asc', search: 'consulting', filters: { isActive: true } });
    expect(req).toHaveBeenCalledWith('GET', '/services', undefined, {
        page: '1',
        limit: '25',
        sort: 'name',
        order: 'asc',
        search: 'consulting',
        filters: JSON.stringify({ isActive: true })
    });
  });

  it('list calls GET /services with no options', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', '/services', undefined, {});
  });

  it('get calls GET /services/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1' });
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    expect(await r.get('s-1')).toEqual({ id: 's-1' });
    expect(req).toHaveBeenCalledWith('GET', '/services/s-1');
  });

  it('create calls POST /services with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-2' });
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    const data = { name: 'Consulting', price: 100, isActive: true };
    expect(await r.create(data)).toEqual({ id: 's-2' });
    expect(req).toHaveBeenCalledWith('POST', '/services', data);
  });

  it('update calls PATCH /services/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 's-1', name: 'Premium Consulting' });
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    const result = await r.update('s-1', { name: 'Premium Consulting' });
    expect(result.name).toBe('Premium Consulting');
    expect(req).toHaveBeenCalledWith('PATCH', '/services/s-1', { name: 'Premium Consulting' });
  });

  it('delete calls DELETE /services/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const r = new ServicesResource(req);
    await r.delete('s-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/services/s-1');
  });
});

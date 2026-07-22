import { describe, it, expect, vi } from 'vitest';

describe('ActivitiesResource', () => {
  it('list calls request with GET /activities and params', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const resource = new ActivitiesResource(mockRequest);
    const result = await resource.list({ page: 1, limit: 10, sort: 'date', order: 'desc', search: 'call', filters: { type: 'call' } });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/activities', undefined, {
      page: '1', limit: '10', sort: 'date', order: 'desc', search: 'call', filters: '{"type":"call"}',
    });
    expect(result).toEqual({ data: [], total: 0 });
  });

  it('list passes undefined params when no options', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const resource = new ActivitiesResource(mockRequest);
    await resource.list();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/activities', undefined, {});
  });

  it('list omits undefined fields from params', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const resource = new ActivitiesResource(mockRequest);
    await resource.list({ page: 2 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/activities', undefined, { page: '2' });
  });

  it('get calls request with GET /activities/:id', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'act-1', type: 'call' });
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const resource = new ActivitiesResource(mockRequest);
    const result = await resource.get('act-1');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/activities/act-1');
    expect(result).toEqual({ id: 'act-1', type: 'call' });
  });

  it('create calls request with POST /activities and data', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'act-2', type: 'note' });
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const resource = new ActivitiesResource(mockRequest);
    const data = { type: 'note' as const, title: 'Test', description: 'A note' };
    const result = await resource.create(data);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/activities', data);
    expect(result).toEqual({ id: 'act-2', type: 'note' });
  });
});

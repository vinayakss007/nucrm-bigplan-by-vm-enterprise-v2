import { describe, it, expect, vi } from 'vitest';

describe('MeetingsResource', () => {
  it('list calls request with GET /meetings and params', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    const result = await resource.list({ page: 1, limit: 10, sort: 'date', order: 'desc', search: 'sync', filters: { status: 'scheduled' } });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/meetings', undefined, {
      page: '1', limit: '10', sort: 'date', order: 'desc', search: 'sync', filters: '{"status":"scheduled"}',
    });
    expect(result).toEqual({ data: [], total: 0 });
  });

  it('list passes undefined params when no options', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    await resource.list();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/meetings', undefined, {});
  });

  it('list omits undefined fields from params', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    await resource.list({ page: 2 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/meetings', undefined, { page: '2' });
  });

  it('get calls request with GET /meetings/:id', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'm-1', title: 'Sync' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    const result = await resource.get('m-1');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/meetings/m-1');
    expect(result).toEqual({ id: 'm-1', title: 'Sync' });
  });

  it('create calls request with POST /meetings and data', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'm-2', title: 'New Sync' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    const data = { title: 'New Sync' } as unknown as import('@/lib/sdk/types').CreateMeeting;
    const result = await resource.create(data);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/meetings', data);
    expect(result).toEqual({ id: 'm-2', title: 'New Sync' });
  });

  it('update calls request with PATCH /meetings/:id and data', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'm-1', title: 'Updated Sync' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    const data = { title: 'Updated Sync' } as unknown as import('@/lib/sdk/types').UpdateMeeting;
    const result = await resource.update('m-1', data);
    expect(mockRequest).toHaveBeenCalledWith('PATCH', '/meetings/m-1', data);
    expect(result).toEqual({ id: 'm-1', title: 'Updated Sync' });
  });

  it('delete calls request with DELETE /meetings/:id', async () => {
    const mockRequest = vi.fn().mockResolvedValue(undefined);
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    await resource.delete('m-1');
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/meetings/m-1');
  });

  it('cancel calls request with POST /meetings/:id/cancel', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ id: 'm-1', status: 'cancelled' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const resource = new MeetingsResource(mockRequest);
    const result = await resource.cancel('m-1');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/meetings/m-1/cancel');
    expect(result).toEqual({ id: 'm-1', status: 'cancelled' });
  });
});

import { describe, it, expect, vi } from 'vitest';

describe('MeetingsResource', () => {
  it('list calls GET /meetings with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    await r.list({ page: 1, limit: 25, sort: 'createdAt', order: 'asc', search: 'q', filters: { status: 'scheduled' } });
    expect(req).toHaveBeenCalledWith('GET', '/meetings', undefined, {
      page: '1',
      limit: '25',
      sort: 'createdAt',
      order: 'asc',
      search: 'q',
      filters: '{"status":"scheduled"}'
    });
  });

  it('list calls GET /meetings without params when no options passed', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', '/meetings', undefined, {});
  });

  it('list omits undefined fields from params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    await r.list({ page: 2 });
    expect(req).toHaveBeenCalledWith('GET', '/meetings', undefined, { page: '2' });
  });

  it('get calls GET /meetings/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'm-1' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    expect(await r.get('m-1')).toEqual({ id: 'm-1' });
    expect(req).toHaveBeenCalledWith('GET', '/meetings/m-1');
  });

  it('create calls POST /meetings with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'm-2' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    const data = { title: 'Sync', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z', attendees: [] } as unknown as import('@/lib/sdk/types').CreateMeeting;
    expect(await r.create(data)).toEqual({ id: 'm-2' });
    expect(req).toHaveBeenCalledWith('POST', '/meetings', data);
  });

  it('update calls PATCH /meetings/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'm-1', title: 'New Sync' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    const result = await r.update('m-1', { title: 'New Sync' });
    expect(result.title).toBe('New Sync');
    expect(req).toHaveBeenCalledWith('PATCH', '/meetings/m-1', { title: 'New Sync' });
  });

  it('delete calls DELETE /meetings/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    await r.delete('m-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/meetings/m-1');
  });

  it('cancel calls POST /meetings/:id/cancel', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'm-1', status: 'cancelled' });
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const r = new MeetingsResource(req);
    const result = await r.cancel('m-1');
    expect(result.status).toBe('cancelled');
    expect(req).toHaveBeenCalledWith('POST', '/meetings/m-1/cancel');
  });
});

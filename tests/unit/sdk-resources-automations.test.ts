import { describe, it, expect, vi } from 'vitest';

describe('AutomationsResource', () => {
  it('list calls GET /automations with no params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', '/automations', undefined, {});
  });

  it('list calls GET /automations with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    await r.list({ page: 2, limit: 10, sort: 'name', order: 'desc', search: 'test', filters: { status: 'active' } });
    expect(req).toHaveBeenCalledWith('GET', '/automations', undefined, {
      page: '2',
      limit: '10',
      sort: 'name',
      order: 'desc',
      search: 'test',
      filters: JSON.stringify({ status: 'active' })
    });
  });

  it('get calls GET /automations/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'a-1' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    expect(await r.get('a-1')).toEqual({ id: 'a-1' });
    expect(req).toHaveBeenCalledWith('GET', '/automations/a-1');
  });

  it('create calls POST /automations with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'a-2' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const data = { name: 'Auto 1', trigger: 'event', actions: [] };
    expect(await r.create(data as any)).toEqual({ id: 'a-2' });
    expect(req).toHaveBeenCalledWith('POST', '/automations', data);
  });

  it('update calls PATCH /automations/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'a-1', name: 'Auto 2' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const data = { name: 'Auto 2' };
    const result = await r.update('a-1', data as any);
    expect(result.name).toBe('Auto 2');
    expect(req).toHaveBeenCalledWith('PATCH', '/automations/a-1', data);
  });

  it('delete calls DELETE /automations/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    await r.delete('a-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/automations/a-1');
  });

  it('trigger calls POST /automations/:id/trigger with data', async () => {
    const req = vi.fn().mockResolvedValue({ runId: 'run-1' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const result = await r.trigger('a-1', { foo: 'bar' });
    expect(result.runId).toBe('run-1');
    expect(req).toHaveBeenCalledWith('POST', '/automations/a-1/trigger', { foo: 'bar' });
  });

  it('trigger calls POST /automations/:id/trigger without data', async () => {
    const req = vi.fn().mockResolvedValue({ runId: 'run-1' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const result = await r.trigger('a-1');
    expect(result.runId).toBe('run-1');
    expect(req).toHaveBeenCalledWith('POST', '/automations/a-1/trigger', undefined);
  });

  it('pause calls POST /automations/:id/pause', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'a-1', status: 'paused' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const result = await r.pause('a-1');
    expect(result.status).toBe('paused');
    expect(req).toHaveBeenCalledWith('POST', '/automations/a-1/pause');
  });

  it('resume calls POST /automations/:id/resume', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'a-1', status: 'active' });
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const r = new AutomationsResource(req);
    const result = await r.resume('a-1');
    expect(result.status).toBe('active');
    expect(req).toHaveBeenCalledWith('POST', '/automations/a-1/resume');
  });
});

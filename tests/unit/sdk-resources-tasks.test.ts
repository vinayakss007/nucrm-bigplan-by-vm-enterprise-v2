import { describe, it, expect, vi } from 'vitest';

describe('TasksResource', () => {
  it('list calls GET /tasks with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    await r.list({ page: 1, limit: 25, sort: 'createdAt', order: 'desc', search: 'test', filters: { status: 'open' } });
    expect(req).toHaveBeenCalledWith('GET', '/tasks', undefined, {
      page: '1',
      limit: '25',
      sort: 'createdAt',
      order: 'desc',
      search: 'test',
      filters: JSON.stringify({ status: 'open' }),
    });
  });

  it('list calls GET /tasks without params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', '/tasks', undefined, {});
  });

  it('get calls GET /tasks/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 't-1' });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    expect(await r.get('t-1')).toEqual({ id: 't-1' });
    expect(req).toHaveBeenCalledWith('GET', '/tasks/t-1');
  });

  it('create calls POST /tasks with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 't-2' });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    const data = { title: 'New Task', dueDate: '2026-12-31', status: 'open' as const };
    expect(await r.create(data)).toEqual({ id: 't-2' });
    expect(req).toHaveBeenCalledWith('POST', '/tasks', data);
  });

  it('update calls PATCH /tasks/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 't-1', title: 'Updated Task' });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    const result = await r.update('t-1', { title: 'Updated Task' });
    expect(result.title).toBe('Updated Task');
    expect(req).toHaveBeenCalledWith('PATCH', '/tasks/t-1', { title: 'Updated Task' });
  });

  it('delete calls DELETE /tasks/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    await r.delete('t-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/tasks/t-1');
  });

  it('complete calls POST /tasks/:id/complete', async () => {
    const req = vi.fn().mockResolvedValue({ id: 't-1', status: 'completed' });
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const r = new TasksResource(req);
    const result = await r.complete('t-1');
    expect(result.status).toBe('completed');
    expect(req).toHaveBeenCalledWith('POST', '/tasks/t-1/complete');
  });
});

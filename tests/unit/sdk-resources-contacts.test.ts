import { describe, it, expect, vi } from 'vitest';

describe('ContactsResource', () => {
  it('list calls GET /contacts with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    await r.list({ page: 1, limit: 25 });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { page: '1', limit: '25' });
  });

  it('get calls GET /contacts/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'c-1' });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    expect(await r.get('c-1')).toEqual({ id: 'c-1' });
    expect(req).toHaveBeenCalledWith('GET', '/contacts/c-1');
  });

  it('create calls POST /contacts with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'c-2' });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    const data = { firstName: 'John', lastName: 'Doe', email: 'john@test.com' };
    expect(await r.create(data)).toEqual({ id: 'c-2' });
    expect(req).toHaveBeenCalledWith('POST', '/contacts', data);
  });

  it('update calls PATCH /contacts/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'c-1', firstName: 'Jane' });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    const result = await r.update('c-1', { firstName: 'Jane' });
    expect(result.firstName).toBe('Jane');
    expect(req).toHaveBeenCalledWith('PATCH', '/contacts/c-1', { firstName: 'Jane' });
  });

  it('delete calls DELETE /contacts/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    await r.delete('c-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/contacts/c-1');
  });

  it('bulkUpdate calls PATCH /contacts/bulk with ids and data', async () => {
    const req = vi.fn().mockResolvedValue({ updated: 3 });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    const result = await r.bulkUpdate(['c-1', 'c-2', 'c-3'], { assignedTo: 'user-1' });
    expect(result.updated).toBe(3);
    expect(req).toHaveBeenCalledWith('PATCH', '/contacts/bulk', { ids: ['c-1', 'c-2', 'c-3'], assignedTo: 'user-1' });
  });

  it('search calls GET /contacts with search param', async () => {
    const req = vi.fn().mockResolvedValue({ data: [{ id: 'c-1' }], total: 1 });
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const r = new ContactsResource(req);
    const result = await r.search('john', { limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { search: 'john', limit: '10' });
  });
});

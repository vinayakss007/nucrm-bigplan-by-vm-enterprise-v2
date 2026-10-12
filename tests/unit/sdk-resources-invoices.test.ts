import { describe, it, expect, vi } from 'vitest';

describe('InvoicesResource', () => {
  it('list calls GET /invoices with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    await r.list({ page: 1, limit: 25 });
    expect(req).toHaveBeenCalledWith('GET', '/invoices', undefined, { page: '1', limit: '25' });
  });

  it('get calls GET /invoices/:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-1' });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    expect(await r.get('inv-1')).toEqual({ id: 'inv-1' });
    expect(req).toHaveBeenCalledWith('GET', '/invoices/inv-1');
  });

  it('create calls POST /invoices with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-2' });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    const data = { amount: 100, status: 'draft' };
    expect(await r.create(data)).toEqual({ id: 'inv-2' });
    expect(req).toHaveBeenCalledWith('POST', '/invoices', data);
  });

  it('update calls PATCH /invoices/:id with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-1', amount: 200 });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    const result = await r.update('inv-1', { amount: 200 });
    expect(result.amount).toBe(200);
    expect(req).toHaveBeenCalledWith('PATCH', '/invoices/inv-1', { amount: 200 });
  });

  it('delete calls DELETE /invoices/:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    await r.delete('inv-1');
    expect(req).toHaveBeenCalledWith('DELETE', '/invoices/inv-1');
  });

  it('markPaid calls POST /invoices/:id/pay with amount and method', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-1', status: 'paid' });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    const result = await r.markPaid('inv-1', '100.00', 'credit_card');
    expect(result.status).toBe('paid');
    expect(req).toHaveBeenCalledWith('POST', '/invoices/inv-1/pay', { amount: '100.00', method: 'credit_card' });
  });

  it('markPaid works without method', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-1', status: 'paid' });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    const result = await r.markPaid('inv-1', '100.00');
    expect(result.status).toBe('paid');
    expect(req).toHaveBeenCalledWith('POST', '/invoices/inv-1/pay', { amount: '100.00', method: undefined });
  });

  it('send calls POST /invoices/:id/send', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'inv-1', status: 'sent' });
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const r = new InvoicesResource(req);
    const result = await r.send('inv-1');
    expect(result.status).toBe('sent');
    expect(req).toHaveBeenCalledWith('POST', '/invoices/inv-1/send');
  });
});

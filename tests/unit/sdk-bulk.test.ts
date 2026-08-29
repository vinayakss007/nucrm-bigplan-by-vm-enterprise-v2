import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestFn } from '@/lib/sdk/types';

describe('sdk/bulk', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('createMany sends items to bulk endpoint', async () => {
    mockRequest.mockResolvedValue({ created: 2, ids: ['c-1', 'c-2'] });
    const { BulkOperations } = await import('@/lib/sdk/bulk');
    const sdk = new BulkOperations(mockRequest as unknown as RequestFn);
    const result = await sdk.createMany('contacts', [{ name: 'A' }, { name: 'B' }]);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/contacts/bulk', { items: [{ name: 'A' }, { name: 'B' }] });
    expect(result.created).toBe(2);
  });

  it('updateMany sends ids and data to bulk endpoint', async () => {
    mockRequest.mockResolvedValue({ updated: 2 });
    const { BulkOperations } = await import('@/lib/sdk/bulk');
    const sdk = new BulkOperations(mockRequest as unknown as RequestFn);
    const result = await sdk.updateMany('contacts', ['c-1', 'c-2'], { lead_status: 'converted' });
    expect(mockRequest).toHaveBeenCalledWith('PATCH', '/contacts/bulk', { ids: ['c-1', 'c-2'], data: { lead_status: 'converted' } });
    expect(result.updated).toBe(2);
  });

  it('deleteMany sends ids to bulk endpoint', async () => {
    mockRequest.mockResolvedValue({ deleted: 2 });
    const { BulkOperations } = await import('@/lib/sdk/bulk');
    const sdk = new BulkOperations(mockRequest as unknown as RequestFn);
    const result = await sdk.deleteMany('contacts', ['c-1', 'c-2']);
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/contacts/bulk', { ids: ['c-1', 'c-2'] });
    expect(result.deleted).toBe(2);
  });
});

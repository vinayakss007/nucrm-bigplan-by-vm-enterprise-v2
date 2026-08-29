import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestFn } from '@/lib/sdk/types';

describe('sdk/search', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('global sends GET request with query param', async () => {
    mockRequest.mockResolvedValue([{ id: 'c-1', type: 'contact' }]);
    const { SearchSDK } = await import('@/lib/sdk/search');
    const sdk = new SearchSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.global('test query');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/search', undefined, { q: 'test query' });
    expect(result).toHaveLength(1);
  });

  it('global passes entities as comma-separated string', async () => {
    mockRequest.mockResolvedValue([]);
    const { SearchSDK } = await import('@/lib/sdk/search');
    const sdk = new SearchSDK(mockRequest as unknown as RequestFn);
    await sdk.global('test', { entities: ['contacts', 'deals'] });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/search', undefined, { q: 'test', entities: 'contacts,deals' });
  });

  it('global passes limit and offset params', async () => {
    mockRequest.mockResolvedValue([]);
    const { SearchSDK } = await import('@/lib/sdk/search');
    const sdk = new SearchSDK(mockRequest as unknown as RequestFn);
    await sdk.global('test', { limit: 10, offset: 20 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/search', undefined, { q: 'test', limit: '10', offset: '20' });
  });

  it('advanced sends POST request with filters', async () => {
    mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, hasMore: false });
    const { SearchSDK } = await import('@/lib/sdk/search');
    const sdk = new SearchSDK(mockRequest as unknown as RequestFn);
    const filters = [{ field: 'status', operator: 'eq', value: 'active' }];
    const result = await sdk.advanced('contacts', filters);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/search/contacts', { filters });
    expect(result.total).toBe(0);
  });
});

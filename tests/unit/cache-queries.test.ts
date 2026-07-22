import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCache = {
  set: vi.fn(),
  get: vi.fn(),
  getOrSet: vi.fn(),
  del: vi.fn(),
  delByPattern: vi.fn(),
  exists: vi.fn(),
};

vi.mock('@/lib/cache/index', () => ({
  cache: mockCache,
}));

describe('cache/queries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('cacheQuery stores data with query prefix', async () => {
    const { cacheQuery } = await import('@/lib/cache/queries');
    await cacheQuery('contacts:list', [{ id: 1 }], 600);
    expect(mockCache.set).toHaveBeenCalledWith('query:contacts:list', [{ id: 1 }], 600);
  });

  it('getCachedQuery retrieves data with query prefix', async () => {
    mockCache.get.mockResolvedValue([{ id: 1 }]);
    const { getCachedQuery } = await import('@/lib/cache/queries');
    const result = await getCachedQuery('contacts:list');
    expect(mockCache.get).toHaveBeenCalledWith('query:contacts:list');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('getQueryOrFetch uses getOrSet with query prefix', async () => {
    mockCache.getOrSet.mockResolvedValue('cached-data');
    const { getQueryOrFetch } = await import('@/lib/cache/queries');
    const fn = vi.fn().mockResolvedValue('fresh-data');
    const result = await getQueryOrFetch('contacts:list', fn, 300);
    expect(mockCache.getOrSet).toHaveBeenCalledWith('query:contacts:list', fn, 300);
    expect(result).toBe('cached-data');
  });

  it('invalidateQuery deletes by key with query prefix', async () => {
    const { invalidateQuery } = await import('@/lib/cache/queries');
    await invalidateQuery('contacts:list');
    expect(mockCache.del).toHaveBeenCalledWith('query:contacts:list');
  });

  it('invalidateTenantQueries deletes by pattern', async () => {
    const { invalidateTenantQueries } = await import('@/lib/cache/queries');
    await invalidateTenantQueries('tenant-1');
    expect(mockCache.delByPattern).toHaveBeenCalledWith('query:tenant-1:*');
  });

  it('QueryKeys generates correct cache key strings', async () => {
    const { QueryKeys } = await import('@/lib/cache/queries');
    expect(QueryKeys.contactsList('t1', 1, 25)).toBe('t1:contacts:list:1:25');
    expect(QueryKeys.contactsById('t1', 'c1')).toBe('t1:contacts:id:c1');
    expect(QueryKeys.dealsList('t1', 'won')).toBe('t1:deals:list:won');
    expect(QueryKeys.dealsList('t1')).toBe('t1:deals:list:all');
    expect(QueryKeys.companiesList('t1')).toBe('t1:companies:list');
    expect(QueryKeys.tasksList('t1', 'pending')).toBe('t1:tasks:list:pending');
    expect(QueryKeys.dashboardStats('t1')).toBe('t1:dashboard:stats');
    expect(QueryKeys.userPermissions('u1', 't1')).toBe('user:u1:tenant:t1:permissions');
    expect(QueryKeys.tenantConfig('t1')).toBe('tenant:t1:config');
  });

  it('CacheTTL has correct presets', async () => {
    const { CacheTTL } = await import('@/lib/cache/queries');
    expect(CacheTTL.short).toBe(60);
    expect(CacheTTL.medium).toBe(300);
    expect(CacheTTL.long).toBe(3600);
    expect(CacheTTL.veryLong).toBe(86400);
  });

  it('cachedQuery decorator wraps method with caching', async () => {
    const { cachedQuery, CacheTTL } = await import('@/lib/cache/queries');
    const decorator = cachedQuery({ key: (id: string) => `item:${id}`, ttl: 600 });
    const method = vi.fn().mockResolvedValue('result');
    const descriptor = { value: method };
    decorator({}, 'test', descriptor);
    mockCache.getOrSet.mockResolvedValue('cached');
    const result = await descriptor.value('abc');
    expect(mockCache.getOrSet).toHaveBeenCalledWith('query:item:abc', expect.any(Function), 600);
    expect(result).toBe('cached');
  });
});

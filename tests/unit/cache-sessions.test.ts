import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCache = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
};

vi.mock('@/lib/cache/index', () => ({
  cache: mockCache,
}));

describe('cache/sessions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('cacheSession stores session data with session prefix', async () => {
    const { cacheSession } = await import('@/lib/cache/sessions');
    await cacheSession('token-123', 'user-1', 'tenant-1');
    expect(mockCache.set).toHaveBeenCalledWith(
      'session:token-123',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', createdAt: expect.any(Number) }),
      2592000
    );
  });

  it('cacheSession stores session without tenantId', async () => {
    const { cacheSession } = await import('@/lib/cache/sessions');
    await cacheSession('token-456', 'user-2');
    expect(mockCache.set).toHaveBeenCalledWith(
      'session:token-456',
      expect.objectContaining({ userId: 'user-2', tenantId: undefined }),
      2592000
    );
  });

  it('getSession retrieves session by token', async () => {
    mockCache.get.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', createdAt: 1000 });
    const { getSession } = await import('@/lib/cache/sessions');
    const result = await getSession('token-123');
    expect(mockCache.get).toHaveBeenCalledWith('session:token-123');
    expect(result?.userId).toBe('user-1');
  });

  it('getSession returns null for missing token', async () => {
    mockCache.get.mockResolvedValue(null);
    const { getSession } = await import('@/lib/cache/sessions');
    const result = await getSession('unknown');
    expect(result).toBeNull();
  });

  it('deleteSession removes session by token', async () => {
    const { deleteSession } = await import('@/lib/cache/sessions');
    await deleteSession('token-123');
    expect(mockCache.del).toHaveBeenCalledWith('session:token-123');
  });

  it('refreshSession re-sets existing session', async () => {
    mockCache.get.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', createdAt: 1000 });
    const { refreshSession } = await import('@/lib/cache/sessions');
    await refreshSession('token-123');
    expect(mockCache.set).toHaveBeenCalledWith(
      'session:token-123',
      { userId: 'user-1', tenantId: 'tenant-1', createdAt: 1000 },
      2592000
    );
  });

  it('refreshSession does nothing for missing session', async () => {
    mockCache.get.mockResolvedValue(null);
    const { refreshSession } = await import('@/lib/cache/sessions');
    await refreshSession('unknown');
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('sessionExists checks existence in cache', async () => {
    mockCache.exists.mockResolvedValue(true);
    const { sessionExists } = await import('@/lib/cache/sessions');
    const result = await sessionExists('token-123');
    expect(mockCache.exists).toHaveBeenCalledWith('session:token-123');
    expect(result).toBe(true);
  });

  it('sessionCache namespace exports all functions', async () => {
    const { sessionCache } = await import('@/lib/cache/sessions');
    expect(sessionCache.cacheSession).toBeDefined();
    expect(sessionCache.getSession).toBeDefined();
    expect(sessionCache.deleteSession).toBeDefined();
    expect(sessionCache.refreshSession).toBeDefined();
    expect(sessionCache.sessionExists).toBeDefined();
    expect(sessionCache.deleteUserSessions).toBeDefined();
    expect(sessionCache.getSessionCount).toBeDefined();
  });
});

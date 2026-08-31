import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const mockCache = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
};

vi.mock('@/lib/cache/index', () => ({
  cache: mockCache,
}));

// #1212: sessions are keyed by a SHA-256 hash of the token, never the raw
// token. These helpers mirror that so tests assert the hashed keys.
const h = (token: string) => createHash('sha256').update(token).digest('hex');
const sessionKey = (token: string) => `session:${h(token)}`;
// #661: the auth-context (permissions) cache is keyed by the SAME token hash.
const contextKey = (token: string) => `auth:context:${h(token)}`;

describe('cache/sessions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockCache.set.mockReset();
    mockCache.get.mockReset();
    mockCache.del.mockReset();
    mockCache.exists.mockReset();
  });

  it('cacheSession stores session data (hashed key) and registers hashed token in user index', async () => {
    mockCache.get.mockResolvedValue(null);
    const { cacheSession } = await import('@/lib/cache/sessions');
    await cacheSession('token-123', 'user-1', 'tenant-1');
    expect(mockCache.set).toHaveBeenCalledWith(
      sessionKey('token-123'),
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', createdAt: expect.any(Number) }),
      2592000
    );
    expect(mockCache.set).toHaveBeenCalledWith(
      'user-sessions:user-1',
      [h('token-123')],
      2592000
    );
    // The raw token must never appear as a key or in the index.
    const setCalls = JSON.stringify(mockCache.set.mock.calls);
    expect(setCalls).not.toContain('token-123');
  });

  it('cacheSession stores session without tenantId', async () => {
    mockCache.get.mockResolvedValue(null);
    const { cacheSession } = await import('@/lib/cache/sessions');
    await cacheSession('token-456', 'user-2');
    expect(mockCache.set).toHaveBeenCalledWith(
      sessionKey('token-456'),
      expect.objectContaining({ userId: 'user-2', tenantId: undefined }),
      2592000
    );
  });

  it('cacheSession appends hashed token to existing user index', async () => {
    mockCache.get.mockResolvedValue([h('token-old')]);
    const { cacheSession } = await import('@/lib/cache/sessions');
    await cacheSession('token-new', 'user-1');
    expect(mockCache.set).toHaveBeenCalledWith(
      'user-sessions:user-1',
      [h('token-old'), h('token-new')],
      2592000
    );
  });

  it('getSession retrieves session by hashed token key', async () => {
    mockCache.get.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', createdAt: 1000 });
    const { getSession } = await import('@/lib/cache/sessions');
    const result = await getSession('token-123');
    expect(mockCache.get).toHaveBeenCalledWith(sessionKey('token-123'));
    expect(result?.userId).toBe('user-1');
  });

  it('getSession returns null for missing token', async () => {
    mockCache.get.mockResolvedValue(null);
    const { getSession } = await import('@/lib/cache/sessions');
    const result = await getSession('unknown');
    expect(result).toBeNull();
  });

  it('deleteSession removes session (hashed key) and cleans up user index', async () => {
    mockCache.get.mockResolvedValueOnce({ userId: 'user-1', createdAt: 1000 });
    mockCache.get.mockResolvedValueOnce([h('token-123'), h('token-other')]);
    const { deleteSession } = await import('@/lib/cache/sessions');
    await deleteSession('token-123');
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-123'));
    expect(mockCache.set).toHaveBeenCalledWith(
      'user-sessions:user-1',
      [h('token-other')],
      2592000
    );
  });

  it('deleteSession removes user index when last token deleted', async () => {
    mockCache.get.mockResolvedValueOnce({ userId: 'user-1', createdAt: 1000 });
    mockCache.get.mockResolvedValueOnce([h('token-123')]);
    const { deleteSession } = await import('@/lib/cache/sessions');
    await deleteSession('token-123');
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-123'));
    expect(mockCache.del).toHaveBeenCalledWith('user-sessions:user-1');
  });

  it('refreshSession re-sets existing session under the hashed key', async () => {
    mockCache.get.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', createdAt: 1000 });
    const { refreshSession } = await import('@/lib/cache/sessions');
    await refreshSession('token-123');
    expect(mockCache.set).toHaveBeenCalledWith(
      sessionKey('token-123'),
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

  it('sessionExists checks existence under the hashed key', async () => {
    mockCache.exists.mockResolvedValue(true);
    const { sessionExists } = await import('@/lib/cache/sessions');
    const result = await sessionExists('token-123');
    expect(mockCache.exists).toHaveBeenCalledWith(sessionKey('token-123'));
    expect(result).toBe(true);
  });

  it('deleteUserSessions deletes all user sessions via reverse index (hashed keys)', async () => {
    mockCache.get.mockResolvedValue([h('token-a'), h('token-b'), h('token-c')]);
    const { deleteUserSessions } = await import('@/lib/cache/sessions');
    await deleteUserSessions('user-1');
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-a'));
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-b'));
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-c'));
    expect(mockCache.del).toHaveBeenCalledWith('user-sessions:user-1');
  });

  it('deleteUserSessions handles user with no sessions', async () => {
    mockCache.get.mockResolvedValue([]);
    const { deleteUserSessions } = await import('@/lib/cache/sessions');
    await deleteUserSessions('user-nobody');
    expect(mockCache.del).not.toHaveBeenCalledWith(expect.stringContaining('session:'));
    expect(mockCache.del).toHaveBeenCalledWith('user-sessions:user-nobody');
  });

  // #661: role/permission changes must take effect on the next request, so
  // clearing a user's sessions has to clear the auth-context (permissions)
  // cache too — not just the session: cache.
  it('deleteUserSessions also busts the auth:context cache for every token', async () => {
    mockCache.get.mockResolvedValue([h('token-a'), h('token-b')]);
    const { deleteUserSessions } = await import('@/lib/cache/sessions');
    await deleteUserSessions('user-1');
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-a'));
    expect(mockCache.del).toHaveBeenCalledWith(contextKey('token-a'));
    expect(mockCache.del).toHaveBeenCalledWith(sessionKey('token-b'));
    expect(mockCache.del).toHaveBeenCalledWith(contextKey('token-b'));
    expect(mockCache.del).toHaveBeenCalledWith('user-sessions:user-1');
  });

  it('invalidateUserContexts clears only the auth:context keys, leaving sessions intact', async () => {
    mockCache.get.mockResolvedValue([h('token-a'), h('token-b')]);
    const { invalidateUserContexts } = await import('@/lib/cache/sessions');
    await invalidateUserContexts('user-1');
    // Context keys cleared for every token.
    expect(mockCache.del).toHaveBeenCalledWith(contextKey('token-a'));
    expect(mockCache.del).toHaveBeenCalledWith(contextKey('token-b'));
    // Sessions and the index survive — the user stays logged in.
    expect(mockCache.del).not.toHaveBeenCalledWith(sessionKey('token-a'));
    expect(mockCache.del).not.toHaveBeenCalledWith(sessionKey('token-b'));
    expect(mockCache.del).not.toHaveBeenCalledWith('user-sessions:user-1');
  });

  it('invalidateUserContexts is a no-op for a user with no tokens', async () => {
    mockCache.get.mockResolvedValue([]);
    const { invalidateUserContexts } = await import('@/lib/cache/sessions');
    await invalidateUserContexts('user-nobody');
    expect(mockCache.del).not.toHaveBeenCalled();
  });

  it('sessionCache namespace exports all functions', async () => {
    const { sessionCache } = await import('@/lib/cache/sessions');
    expect(sessionCache.cacheSession).toBeDefined();
    expect(sessionCache.getSession).toBeDefined();
    expect(sessionCache.deleteSession).toBeDefined();
    expect(sessionCache.refreshSession).toBeDefined();
    expect(sessionCache.sessionExists).toBeDefined();
    expect(sessionCache.deleteUserSessions).toBeDefined();
    expect(sessionCache.invalidateUserContexts).toBeDefined();
    expect(sessionCache.getSessionCount).toBeDefined();
  });
});

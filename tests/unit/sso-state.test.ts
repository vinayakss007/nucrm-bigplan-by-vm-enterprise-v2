import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('jose', () => ({
  SignJWT: vi.fn(),
  jwtVerify: vi.fn(),
}));

describe('SSO State', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('setSsoState', () => {
    it('signs JWT and sets cookie', async () => {
      const mockSet = vi.fn();
      const { cookies } = await import('next/headers');
      (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ set: mockSet });

      const mockSign = vi.fn(() => ({
        setProtectedHeader: vi.fn(() => ({
          setIssuedAt: vi.fn(() => ({
            setExpirationTime: vi.fn(() => ({
              sign: vi.fn(() => Promise.resolve('signed-jwt-token')),
            })),
          })),
        })),
      }));

      const { SignJWT } = await import('jose');
      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSign);

      const { setSsoState } = await import('@/lib/auth/sso/state');
      await setSsoState({
        providerId: 'p1',
        tenantId: 't1',
        state: 'random-state',
        nonce: 'random-nonce',
        redirectTo: '/dashboard',
      });

      expect(mockSet).toHaveBeenCalled();
      expect(mockSet.mock.calls[0][0]).toBe('nucrm_sso_state');
      expect(mockSet.mock.calls[0][1]).toBe('signed-jwt-token');
    });
  });

  describe('readSsoState', () => {
    it('returns null when no cookie', async () => {
      const { cookies } = await import('next/headers');
      (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ get: vi.fn(() => undefined) });

      const { readSsoState } = await import('@/lib/auth/sso/state');
      const result = await readSsoState();
      expect(result).toBeNull();
    });

    it('returns payload when JWT verifies', async () => {
      const { cookies } = await import('next/headers');
      (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        get: vi.fn(() => ({ value: 'valid-jwt' })),
      });

      const { jwtVerify } = await import('jose');
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          providerId: 'p1',
          tenantId: 't1',
          state: 'state-val',
          nonce: 'nonce-val',
        },
      });

      const { readSsoState } = await import('@/lib/auth/sso/state');
      const result = await readSsoState();
      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('p1');
      expect(result!.state).toBe('state-val');
    });

    it('returns null when JWT verification fails', async () => {
      const { cookies } = await import('next/headers');
      (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        get: vi.fn(() => ({ value: 'invalid-jwt' })),
      });

      const { jwtVerify } = await import('jose');
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('JWT expired'));

      const { readSsoState } = await import('@/lib/auth/sso/state');
      const result = await readSsoState();
      expect(result).toBeNull();
    });
  });

  describe('clearSsoState', () => {
    it('deletes the state cookie', async () => {
      const mockDelete = vi.fn();
      const { cookies } = await import('next/headers');
      (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ delete: mockDelete });

      const { clearSsoState } = await import('@/lib/auth/sso/state');
      await clearSsoState();
      expect(mockDelete).toHaveBeenCalledWith('nucrm_sso_state');
    });
  });
});

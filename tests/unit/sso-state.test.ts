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

      const mockSign = vi.fn(function MockSignJWT() {
        return {
          setProtectedHeader: vi.fn(() => ({
            setIssuedAt: vi.fn(() => ({
              setExpirationTime: vi.fn(() => ({
                sign: vi.fn(() => Promise.resolve('signed-jwt-token')),
              })),
            })),
          })),
        };
      });

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

describe('sanitizeRedirectTo (#1213 — CWE-601 open redirect)', () => {
  it('accepts same-origin relative paths', async () => {
    const { sanitizeRedirectTo } = await import('@/lib/auth/sso/state');
    expect(sanitizeRedirectTo('/tenant')).toBe('/tenant');
    expect(sanitizeRedirectTo('/tenant/contacts?tab=a')).toBe('/tenant/contacts?tab=a');
    expect(sanitizeRedirectTo('/deals/123')).toBe('/deals/123');
  });

  it('rejects protocol-relative URLs', async () => {
    const { sanitizeRedirectTo } = await import('@/lib/auth/sso/state');
    expect(sanitizeRedirectTo('//evil.com')).toBe('/tenant');
    expect(sanitizeRedirectTo('//evil.com/path?token=stolen')).toBe('/tenant');
  });

  it('rejects backslash and mixed-separator variants', async () => {
    const { sanitizeRedirectTo } = await import('@/lib/auth/sso/state');
    expect(sanitizeRedirectTo('/\\evil.com')).toBe('/tenant');
    expect(sanitizeRedirectTo('\\evil.com')).toBe('/tenant');
    expect(sanitizeRedirectTo('/path\\evil.com')).toBe('/tenant');
  });

  it('rejects absolute URLs and schemes', async () => {
    const { sanitizeRedirectTo } = await import('@/lib/auth/sso/state');
    expect(sanitizeRedirectTo('https://evil.com')).toBe('/tenant');
    expect(sanitizeRedirectTo('javascript:alert(1)')).toBe('/tenant');
    expect(sanitizeRedirectTo('data:text/html,<script>')).toBe('/tenant');
  });

  it('falls back for empty values and honours a custom fallback', async () => {
    const { sanitizeRedirectTo } = await import('@/lib/auth/sso/state');
    expect(sanitizeRedirectTo(undefined)).toBe('/tenant');
    expect(sanitizeRedirectTo(null)).toBe('/tenant');
    expect(sanitizeRedirectTo('')).toBe('/tenant');
    expect(sanitizeRedirectTo('//evil.com', '/dashboard')).toBe('/dashboard');
  });
});

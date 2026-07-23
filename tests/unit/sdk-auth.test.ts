import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sdk/auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('constructor stores token and request', async () => {
    const { AuthSDK } = await import('@/lib/sdk/auth');
    const sdk = new AuthSDK({ baseUrl: 'https://crm.com', apiKey: 'key-1' }, mockRequest as any);
    expect(sdk.getToken()).toBe('key-1');
  });

  it('setToken updates the internal token', async () => {
    const { AuthSDK } = await import('@/lib/sdk/auth');
    const sdk = new AuthSDK({ baseUrl: 'https://crm.com', apiKey: 'key-1' }, mockRequest as any);
    sdk.setToken('new-token');
    expect(sdk.getToken()).toBe('new-token');
  });

  it('refreshToken calls request and updates token', async () => {
    mockRequest.mockResolvedValue({ token: 'refreshed-token' });
    const { AuthSDK } = await import('@/lib/sdk/auth');
    const sdk = new AuthSDK({ baseUrl: 'https://crm.com', apiKey: 'key-1' }, mockRequest as any);
    const result = await sdk.refreshToken();
    expect(mockRequest).toHaveBeenCalledWith('POST', '/auth/refresh');
    expect(result).toBe('refreshed-token');
    expect(sdk.getToken()).toBe('refreshed-token');
  });

  it('impersonate calls request with userId', async () => {
    mockRequest.mockResolvedValue({ token: 'impersonation-token' });
    const { AuthSDK } = await import('@/lib/sdk/auth');
    const sdk = new AuthSDK({ baseUrl: 'https://crm.com', apiKey: 'key-1' }, mockRequest as any);
    const result = await sdk.impersonate('user-123');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/auth/impersonate', { userId: 'user-123' });
    expect(result.token).toBe('impersonation-token');
  });

  it('initSSO calls request with provider and redirectUrl', async () => {
    mockRequest.mockResolvedValue({ url: 'https://sso.provider.com/auth' });
    const { AuthSDK } = await import('@/lib/sdk/auth');
    const sdk = new AuthSDK({ baseUrl: 'https://crm.com', apiKey: 'key-1' }, mockRequest as any);
    const result = await sdk.initSSO('google', 'https://crm.com/callback');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/auth/sso/init', { provider: 'google', redirectUrl: 'https://crm.com/callback' });
    expect(result.url).toContain('sso.provider.com');
  });
});

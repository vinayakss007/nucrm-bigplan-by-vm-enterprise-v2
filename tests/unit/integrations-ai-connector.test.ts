import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IntegrationInstance } from '@/lib/integrations/types';

// Bypass the SSRF guard so stubbed global fetch is reached (guard has its own suite).
vi.mock('@/lib/security/ssrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ssrf')>();
  return {
    ...actual,
    safeFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input as string, init)) as typeof actual.safeFetch,
    assertSafeUrl: () => undefined,
    resolveAndValidateIp: async () => undefined,
  };
});

describe('integrations/ai-connector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('aiConnector', () => {
    it('returns error when all fetch patterns fail', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const { aiConnector } = await import('../../lib/integrations/ai-connector');
      const result = await aiConnector(
        { providerId: 'custom', config: {} } as unknown as IntegrationInstance,
        'send_email',
        { to: 'test@test.com', subject: 'Hi', body: 'Hello' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not connect to custom');
    });

    it('returns success when a pattern succeeds', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Sent' }),
        headers: new Headers(),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { aiConnector } = await import('../../lib/integrations/ai-connector');
      const result = await aiConnector(
        { providerId: 'sendgrid', config: { api_key: 'test-key' } } as unknown as IntegrationInstance,
        'send_email',
        { to: 'test@test.com', subject: 'Hi', body: 'Hello' }
      );
      expect(result.success).toBe(true);
    });

    it('returns auth error on 401 response', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
        headers: new Headers(),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { aiConnector } = await import('../../lib/integrations/ai-connector');
      const result = await aiConnector(
        { providerId: 'stripe', config: {} } as unknown as IntegrationInstance,
        'send_email',
        { to: 'test@test.com' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });

    it('uses basic auth when specified in config', async () => {
      let capturedHeaders: Record<string, string> = {};
      const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
        capturedHeaders = opts.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { aiConnector } = await import('../../lib/integrations/ai-connector');
      await aiConnector(
        { providerId: 'stripe', config: { api_key: 'sk_test_123', base_url: 'https://api.stripe.com/v1' } } as unknown as IntegrationInstance,
        'list',
        { resource: 'charges' }
      );
      expect(capturedHeaders['Authorization']).toContain('Bearer');
    });
  });
});

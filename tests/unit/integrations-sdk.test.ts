import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('integrations/sdk', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createNuCRM', () => {
    it('creates a client with config', async () => {
      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com' });
      expect(client).toBeDefined();
      expect(client.ping).toBeDefined();
      expect(client.contacts).toBeDefined();
      expect(client.deals).toBeDefined();
    });

    it('strips trailing slash from baseUrl', async () => {
      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com/' });
      expect(client).toBeDefined();
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true for valid signature', async () => {
      const { verifyWebhookSignature } = await import('../../lib/integrations/sdk');
      const payload = 'test-payload';
      const secret = 'my-secret';
      const { createHmac } = await import('crypto');
      const expectedSig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      expect(verifyWebhookSignature(payload, expectedSig, secret)).toBe(true);
    });

    it('returns false for invalid signature', async () => {
      const { verifyWebhookSignature } = await import('../../lib/integrations/sdk');
      expect(verifyWebhookSignature('payload', 'sha256:bad-signature', 'secret')).toBe(false);
    });

    it('returns false when signature length differs', async () => {
      const { verifyWebhookSignature } = await import('../../lib/integrations/sdk');
      expect(verifyWebhookSignature('payload', 'short', 'secret')).toBe(false);
    });
  });

  describe('NuCRMClient', () => {
    it('ping returns ok when fetch succeeds', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ tenant_id: 'tenant-1' }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com' });
      const result = await client.ping();
      expect(result.ok).toBe(true);
      expect(result.tenant).toBe('tenant-1');
    });

    it('ping returns error when fetch fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com' });
      const result = await client.ping();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('contacts.list calls API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [], total: 0 }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com' });
      const result = await client.contacts.list();
      expect(result.data).toEqual([]);
    });

    it('forms.submit uses direct fetch without Bearer auth', async () => {
      const mockFetch = vi.fn((_url: string, _opts: RequestInit) => {
        return Promise.resolve({ json: () => Promise.resolve({ success: true }), ok: true });
      });
      vi.stubGlobal('fetch', mockFetch);

      const { createNuCRM } = await import('../../lib/integrations/sdk');
      const client = createNuCRM({ apiKey: 'test-key', baseUrl: 'https://crm.example.com' });
      const result = await client.forms.submit('form-1', { name: 'test' });
      expect(result).toEqual({ success: true });
    });
  });
});

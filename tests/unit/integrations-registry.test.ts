import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('integrations/registry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getProviderDef', () => {
    it('returns provider definition for known provider', async () => {
      const { getProviderDef } = await import('../../lib/integrations/registry');
      const def = getProviderDef('sendgrid');
      expect(def).toBeDefined();
      expect(def!.id).toBe('sendgrid');
    });

    it('returns undefined for unknown provider', async () => {
      const { getProviderDef } = await import('../../lib/integrations/registry');
      const def = getProviderDef('unknown-provider');
      expect(def).toBeUndefined();
    });
  });

  describe('getAllProviders', () => {
    it('returns all built-in providers', async () => {
      const { getAllProviders } = await import('../../lib/integrations/registry');
      const providers = getAllProviders();
      expect(providers.length).toBeGreaterThanOrEqual(4);
      expect(providers.map(p => p.id)).toContain('sendgrid');
      expect(providers.map(p => p.id)).toContain('slack');
      expect(providers.map(p => p.id)).toContain('mailgun');
      expect(providers.map(p => p.id)).toContain('openai');
    });
  });

  describe('executeAction', () => {
    it('returns error for unknown sendgrid action', async () => {
      vi.stubGlobal('fetch', vi.fn());

      const { executeAction } = await import('../../lib/integrations/registry');
      const result = await executeAction(
        { providerId: 'sendgrid', config: { api_key: 'test', from_email: 'a@b.com' } } as any,
        'unknown_action',
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('returns error when required params missing for sendgrid send_email', async () => {
      vi.stubGlobal('fetch', vi.fn());

      const { executeAction } = await import('../../lib/integrations/registry');
      const result = await executeAction(
        { providerId: 'sendgrid', config: { api_key: 'test', from_email: 'a@b.com' } } as any,
        'send_email',
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns handler error when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const { executeAction } = await import('../../lib/integrations/registry');
      const result = await executeAction(
        { providerId: 'sendgrid', config: { api_key: 'test', from_email: 'a@b.com' } } as any,
        'send_email',
        { to: 'user@test.com', subject: 'Test', body: '<p>Hi</p>' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('falls back to AI connector for unknown provider', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection failed'));
      vi.stubGlobal('fetch', mockFetch);

      const { executeAction } = await import('../../lib/integrations/registry');
      const result = await executeAction(
        { providerId: 'nonexistent', config: {} } as any,
        'send_email',
        { to: 'test@test.com' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not connect to nonexistent');
    });
  });
});

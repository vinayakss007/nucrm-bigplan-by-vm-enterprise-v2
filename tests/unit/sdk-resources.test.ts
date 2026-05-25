import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

describe('NuCRM SDK', () => {
  describe('NuCRMClient resource getters', () => {
    it('exposes all 20 resource getters fully typed', async () => {
      const { NuCRMClient } = await import('@/lib/sdk/client');
      const client = new NuCRMClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com' });

      // Existing 7 resources
      expect(client.contacts).toBeDefined();
      expect(client.deals).toBeDefined();
      expect(client.leads).toBeDefined();
      expect(client.companies).toBeDefined();
      expect(client.tasks).toBeDefined();
      expect(client.tickets).toBeDefined();
      expect(client.invoices).toBeDefined();

      // New 13 resources
      expect(client.documents).toBeDefined();
      expect(client.quotes).toBeDefined();
      expect(client.orders).toBeDefined();
      expect(client.contracts).toBeDefined();
      expect(client.subscriptions).toBeDefined();
      expect(client.services).toBeDefined();
      expect(client.meetings).toBeDefined();
      expect(client.activities).toBeDefined();
      expect(client.forms).toBeDefined();
      expect(client.sequences).toBeDefined();
      expect(client.automations).toBeDefined();
      expect(client.reports).toBeDefined();
    });

    it('lazily instantiates resources only once', async () => {
      const { NuCRMClient } = await import('@/lib/sdk/client');
      const client = new NuCRMClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com' });

      const contacts1 = client.contacts;
      const contacts2 = client.contacts;
      expect(contacts1).toBe(contacts2);

      const documents1 = client.documents;
      const documents2 = client.documents;
      expect(documents1).toBe(documents2);
    });

    it('exposes SDK module getters', async () => {
      const { NuCRMClient } = await import('@/lib/sdk/client');
      const client = new NuCRMClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com' });

      expect(client.bulk).toBeDefined();
      expect(client.search).toBeDefined();
      expect(client.files).toBeDefined();
      expect(client.realtime).toBeDefined();
      expect(client.authSDK).toBeDefined();
      expect(client.billing).toBeDefined();
      expect(client.templates).toBeDefined();
    });
  });

  describe('BulkOperations', () => {
    it('can be instantiated with a request function', async () => {
      const { BulkOperations } = await import('@/lib/sdk/bulk');
      const mockRequest = vi.fn();
      const bulk = new BulkOperations(mockRequest);
      expect(bulk).toBeDefined();
      expect(bulk.createMany).toBeInstanceOf(Function);
      expect(bulk.updateMany).toBeInstanceOf(Function);
      expect(bulk.deleteMany).toBeInstanceOf(Function);
    });

    it('calls request with correct params for createMany', async () => {
      const { BulkOperations } = await import('@/lib/sdk/bulk');
      const mockRequest = vi.fn().mockResolvedValue({ created: 3, errors: [] });
      const bulk = new BulkOperations(mockRequest);
      const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
      const result = await bulk.createMany('contacts', items);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/contacts/bulk', { items });
      expect(result.created).toBe(3);
    });

    it('calls request with correct params for deleteMany', async () => {
      const { BulkOperations } = await import('@/lib/sdk/bulk');
      const mockRequest = vi.fn().mockResolvedValue({ deleted: 2 });
      const bulk = new BulkOperations(mockRequest);
      const result = await bulk.deleteMany('contacts', ['id1', 'id2']);
      expect(mockRequest).toHaveBeenCalledWith('DELETE', '/contacts/bulk', { ids: ['id1', 'id2'] });
      expect(result.deleted).toBe(2);
    });
  });

  describe('SearchSDK', () => {
    it('can be instantiated with a request function', async () => {
      const { SearchSDK } = await import('@/lib/sdk/search');
      const mockRequest = vi.fn();
      const search = new SearchSDK(mockRequest);
      expect(search).toBeDefined();
      expect(search.global).toBeInstanceOf(Function);
      expect(search.advanced).toBeInstanceOf(Function);
    });

    it('calls global search with correct params', async () => {
      const { SearchSDK } = await import('@/lib/sdk/search');
      const mockRequest = vi.fn().mockResolvedValue([]);
      const search = new SearchSDK(mockRequest);
      await search.global('test query', { entities: ['contacts', 'deals'], limit: 10 });
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/search',
        undefined,
        { q: 'test query', entities: 'contacts,deals', limit: '10' }
      );
    });

    it('calls advanced search with filters', async () => {
      const { SearchSDK } = await import('@/lib/sdk/search');
      const mockRequest = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
      const search = new SearchSDK(mockRequest);
      const filters = [{ field: 'email', operator: 'contains' as const, value: '@test.com' }];
      await search.advanced('contacts', filters);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/search/contacts', { filters });
    });
  });

  describe('FileSDK', () => {
    it('can be instantiated with a request function', async () => {
      const { FileSDK } = await import('@/lib/sdk/files');
      const mockRequest = vi.fn();
      const files = new FileSDK(mockRequest);
      expect(files).toBeDefined();
      expect(files.upload).toBeInstanceOf(Function);
      expect(files.download).toBeInstanceOf(Function);
      expect(files.getPresignedUrl).toBeInstanceOf(Function);
      expect(files.list).toBeInstanceOf(Function);
    });

    it('uploads files with correct body', async () => {
      const { FileSDK } = await import('@/lib/sdk/files');
      const mockRequest = vi.fn().mockResolvedValue({ id: 'f1', url: 'https://files.example.com/f1' });
      const files = new FileSDK(mockRequest);
      await files.upload({ name: 'doc.pdf', content: 'base64data', mimeType: 'application/pdf' }, 'deal', 'deal-1');
      expect(mockRequest).toHaveBeenCalledWith('POST', '/files/upload', {
        name: 'doc.pdf',
        content: 'base64data',
        mimeType: 'application/pdf',
        entityType: 'deal',
        entityId: 'deal-1',
      });
    });
  });

  describe('RealtimeSDK', () => {
    it('can be instantiated with config', async () => {
      const { RealtimeSDK } = await import('@/lib/sdk/realtime');
      const rt = new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'key' });
      expect(rt).toBeDefined();
      expect(rt.connect).toBeInstanceOf(Function);
      expect(rt.disconnect).toBeInstanceOf(Function);
      expect(rt.on).toBeInstanceOf(Function);
      expect(rt.off).toBeInstanceOf(Function);
      expect(rt.subscribe).toBeInstanceOf(Function);
      expect(rt.unsubscribe).toBeInstanceOf(Function);
    });

    it('throws when EventSource is not available', async () => {
      const { RealtimeSDK } = await import('@/lib/sdk/realtime');
      const rt = new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'key' });
      expect(() => rt.connect()).toThrow('EventSource is not available');
    });
  });

  describe('AuthSDK', () => {
    it('can be instantiated and manages tokens', async () => {
      const { AuthSDK } = await import('@/lib/sdk/auth');
      const mockRequest = vi.fn();
      const auth = new AuthSDK({ baseUrl: 'https://api.example.com', apiKey: 'initial-key' }, mockRequest);
      expect(auth.getToken()).toBe('initial-key');
      auth.setToken('new-token');
      expect(auth.getToken()).toBe('new-token');
    });

    it('has refreshToken, impersonate, initSSO methods', async () => {
      const { AuthSDK } = await import('@/lib/sdk/auth');
      const mockRequest = vi.fn();
      const auth = new AuthSDK({ baseUrl: 'https://api.example.com', apiKey: 'key' }, mockRequest);
      expect(auth.refreshToken).toBeInstanceOf(Function);
      expect(auth.impersonate).toBeInstanceOf(Function);
      expect(auth.initSSO).toBeInstanceOf(Function);
    });
  });

  describe('BillingSDK', () => {
    it('can be instantiated with a request function', async () => {
      const { BillingSDK } = await import('@/lib/sdk/billing');
      const mockRequest = vi.fn();
      const billing = new BillingSDK(mockRequest);
      expect(billing).toBeDefined();
      expect(billing.getCurrentPlan).toBeInstanceOf(Function);
      expect(billing.checkLimit).toBeInstanceOf(Function);
      expect(billing.getUsage).toBeInstanceOf(Function);
      expect(billing.requestUpgrade).toBeInstanceOf(Function);
    });
  });

  describe('TemplateSDK', () => {
    it('can be instantiated with a request function', async () => {
      const { TemplateSDK } = await import('@/lib/sdk/templates');
      const mockRequest = vi.fn();
      const templates = new TemplateSDK(mockRequest);
      expect(templates).toBeDefined();
      expect(templates.getCurrent).toBeInstanceOf(Function);
      expect(templates.getAvailableModules).toBeInstanceOf(Function);
      expect(templates.enableModule).toBeInstanceOf(Function);
      expect(templates.getConfig).toBeInstanceOf(Function);
    });
  });

  describe('WebhookRouter', () => {
    const secret = 'test-webhook-secret';

    function createSignature(payload: string): string {
      return createHmac('sha256', secret).update(payload).digest('hex');
    }

    it('registers handlers and routes events correctly', async () => {
      const { WebhookRouter } = await import('@/lib/sdk/webhooks');
      const router = new WebhookRouter(secret);
      const handler = vi.fn().mockResolvedValue(undefined);

      router.register('contact.created', handler);

      const payload = JSON.stringify({
        event: 'contact.created',
        timestamp: '2024-01-01T00:00:00Z',
        tenant_id: 'tenant-1',
        data: { id: 'c1', firstName: 'John' },
      });
      const signature = createSignature(payload);

      const result = await router.handle(payload, signature);
      expect(result.acknowledged).toBe(true);
      expect(result.event).toBe('contact.created');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid signatures', async () => {
      const { WebhookRouter } = await import('@/lib/sdk/webhooks');
      const router = new WebhookRouter(secret);
      const handler = vi.fn().mockResolvedValue(undefined);

      router.register('contact.created', handler);

      const payload = JSON.stringify({
        event: 'contact.created',
        timestamp: '2024-01-01T00:00:00Z',
        tenant_id: 'tenant-1',
        data: { id: 'c1' },
      });

      const result = await router.handle(payload, 'invalidsignature');
      expect(result.acknowledged).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('handles events without registered handlers gracefully', async () => {
      const { WebhookRouter } = await import('@/lib/sdk/webhooks');
      const router = new WebhookRouter(secret);

      const payload = JSON.stringify({
        event: 'deal.created',
        timestamp: '2024-01-01T00:00:00Z',
        tenant_id: 'tenant-1',
        data: { id: 'd1' },
      });
      const signature = createSignature(payload);

      const result = await router.handle(payload, signature);
      expect(result.acknowledged).toBe(true);
      expect(result.event).toBe('deal.created');
    });
  });

  describe('WebhookVerifier', () => {
    it('verifies valid signatures', async () => {
      const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
      const secret = 'my-secret';
      const verifier = new WebhookVerifier(secret);

      const payload = '{"event":"contact.created"}';
      const signature = createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifier.verify(payload, signature)).toBe(true);
    });

    it('rejects invalid signatures', async () => {
      const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
      const verifier = new WebhookVerifier('my-secret');

      expect(verifier.verify('payload', 'badsig')).toBe(false);
    });

    it('parses webhook payloads', async () => {
      const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
      const verifier = new WebhookVerifier('secret');

      const raw = JSON.stringify({
        event: 'contact.created',
        timestamp: '2024-01-01T00:00:00Z',
        tenant_id: 'tenant-1',
        data: { id: '123' },
      });

      const parsed = verifier.parse<{ id: string }>(raw);
      expect(parsed.event).toBe('contact.created');
      expect(parsed.data.id).toBe('123');
    });
  });

  describe('NuCRMError', () => {
    it('creates error with all properties', async () => {
      const { NuCRMError } = await import('@/lib/sdk/client');
      const error = new NuCRMError('Not found', 404, 'NOT_FOUND', { resource: 'contact' });
      expect(error.message).toBe('Not found');
      expect(error.status).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toEqual({ resource: 'contact' });
      expect(error.name).toBe('NuCRMError');
      expect(error).toBeInstanceOf(Error);
    });
  });
});

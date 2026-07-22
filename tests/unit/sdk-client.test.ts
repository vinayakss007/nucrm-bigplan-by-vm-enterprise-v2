import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sdk/client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('NuCRMClient constructor stores config', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com/' });
    expect(client).toBeInstanceOf(NuCRMClient);
  });

  it('NuCRMClient strips trailing slash from baseUrl', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com/' });
    expect((client as any).baseUrl).toBe('https://crm.com');
  });

  it('NuCRMClient lazy-loads contacts resource', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    const contacts = client.contacts;
    expect(contacts).toBeDefined();
    expect(client.contacts).toBe(contacts);
  });

  it('NuCRMClient lazy-loads deals resource', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    expect(client.deals).toBeDefined();
  });

  it('NuCRMClient lazy-loads all resource getters', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    const getters = ['contacts', 'deals', 'leads', 'companies', 'tasks', 'tickets', 'invoices',
      'documents', 'quotes', 'orders', 'contracts', 'subscriptions', 'services', 'meetings',
      'activities', 'forms', 'sequences', 'automations', 'reports'] as const;
    for (const g of getters) {
      expect(client[g]).toBeDefined();
    }
  });

  it('NuCRMClient lazy-loads SDK modules', async () => {
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    expect(client.bulk).toBeDefined();
    expect(client.search).toBeDefined();
    expect(client.files).toBeDefined();
    expect(client.realtime).toBeDefined();
    expect(client.authSDK).toBeDefined();
    expect(client.billing).toBeDefined();
    expect(client.templates).toBeDefined();
  });

  it('NuCRMError creates error with status and code', async () => {
    const { NuCRMError } = await import('@/lib/sdk/client');
    const err = new NuCRMError('Not found', 404, 'NOT_FOUND', { id: '123' });
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.details).toEqual({ id: '123' });
    expect(err.name).toBe('NuCRMError');
  });

  it('NuCRMError defaults code and details', async () => {
    const { NuCRMError } = await import('@/lib/sdk/client');
    const err = new NuCRMError('Server error', 500);
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('_request sends fetch with correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ data: [] }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    const result = await (client as any)._request('GET', '/contacts');
    expect(mockFetch).toHaveBeenCalledWith('https://crm.com/api/tenant/contacts', expect.objectContaining({
      method: 'GET',
      headers: { 'Authorization': 'Bearer ak_test', 'Content-Type': 'application/json' },
    }));
    expect(result).toEqual({ data: [] });
    globalThis.fetch = originalFetch;
  });

  it('_request appends query params', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    await (client as any)._request('GET', '/search', undefined, { q: 'test', limit: '10' });
    expect(mockFetch).toHaveBeenCalledWith('https://crm.com/api/tenant/search?q=test&limit=10', expect.any(Object));
    globalThis.fetch = originalFetch;
  });

  it('_request throws NuCRMError on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: vi.fn().mockResolvedValue({ error: 'Forbidden', code: 'FORBIDDEN' }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient, NuCRMError } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    await expect((client as any)._request('POST', '/contacts')).rejects.toThrow(NuCRMError);
    globalThis.fetch = originalFetch;
  });

  it('_request returns undefined for 204', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    const result = await (client as any)._request('DELETE', '/contacts/1');
    expect(result).toBeUndefined();
    globalThis.fetch = originalFetch;
  });

  it('_request throws timeout error on abort', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient, NuCRMError } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com', timeout: 100 });
    await expect((client as any)._request('GET', '/slow')).rejects.toThrow(NuCRMError);
    globalThis.fetch = originalFetch;
  });

  it('_request throws network error on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { NuCRMClient, NuCRMError } = await import('@/lib/sdk/client');
    const client = new NuCRMClient({ apiKey: 'ak_test', baseUrl: 'https://crm.com' });
    await expect((client as any)._request('GET', '/offline')).rejects.toThrow(NuCRMError);
    globalThis.fetch = originalFetch;
  });
});

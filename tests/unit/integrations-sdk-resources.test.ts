/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coverage for the NuCRMClient resource namespaces in lib/integrations/sdk.ts.
 *
 * tests/unit/integrations-sdk.test.ts covers `createNuCRM`, `ping` and
 * `verifyWebhookSignature`. The eight resource namespaces — contacts, deals,
 * tasks, companies, search, webhooks, forms, automation — were never called,
 * which is why the file reported 86% *statements* but only 24% *functions*:
 * every arrow function in those object literals counted as uncovered.
 *
 * This is a client for our own HTTP API, so the contract under test is the
 * request it builds: path, verb, auth headers and JSON body. Those are exactly
 * what breaks silently when a route is renamed, so each assertion pins the
 * wire format rather than just checking the promise resolved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BASE = 'https://crm.example.com';

let fetchMock: ReturnType<typeof vi.fn>;

/** Last fetch call, decoded into the pieces we assert on. */
function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return {
    url,
    path: url.replace(BASE, ''),
    method: (init?.method ?? 'GET') as string,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
}

async function client(overrides: Record<string, unknown> = {}) {
  const { createNuCRM } = await import('@/lib/integrations/sdk');
  return createNuCRM({ apiKey: 'ak_live_test', baseUrl: BASE, ...overrides } as any);
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [], total: 0 }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('request construction', () => {
  it('sends the API key as a Bearer token on every call', async () => {
    const c = await client();
    await c.contacts.list();
    expect(lastRequest().headers['Authorization']).toBe('Bearer ak_live_test');
    expect(lastRequest().headers['Content-Type']).toBe('application/json');
  });

  it('forwards tenantId as X-Tenant-ID when configured', async () => {
    const c = await client({ tenantId: 'tenant-7' });
    await c.contacts.list();
    expect(lastRequest().headers['X-Tenant-ID']).toBe('tenant-7');
  });

  it('sends an empty X-Tenant-ID rather than "undefined" when unset', async () => {
    const c = await client();
    await c.contacts.list();
    // A literal "undefined" here would be forwarded to the API as a tenant id.
    expect(lastRequest().headers['X-Tenant-ID']).toBe('');
  });

  it('strips a trailing slash so paths never double up', async () => {
    const c = await client({ baseUrl: `${BASE}/` });
    await c.contacts.list();
    expect(lastRequest().url).toBe(`${BASE}/api/tenant/contacts?`);
    expect(lastRequest().url).not.toContain('//api');
  });

  it('throws the API-supplied error message on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden: missing scope' }),
    } as any);
    const c = await client();
    await expect(c.contacts.list()).rejects.toThrow('Forbidden: missing scope');
  });

  it('falls back to the status code when the body carries no error field', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) } as any);
    const c = await client();
    await expect(c.deals.list()).rejects.toThrow('HTTP 502');
  });

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'c1' }], total: 1 }),
    } as any);
    const c = await client();
    await expect(c.contacts.list()).resolves.toEqual({ data: [{ id: 'c1' }], total: 1 });
  });
});

describe('contacts', () => {
  it('list() serialises filters into the query string', async () => {
    const c = await client();
    await c.contacts.list({ limit: 25, offset: 50, q: 'ann smith', lead_status: 'new' });
    const { path } = lastRequest();
    expect(path).toContain('limit=25');
    expect(path).toContain('offset=50');
    expect(path).toContain('lead_status=new');
    expect(path).toContain('q=ann+smith');
  });

  it('list() with no params still hits the collection endpoint', async () => {
    const c = await client();
    await c.contacts.list();
    expect(lastRequest().path).toBe('/api/tenant/contacts?');
  });

  it('get() addresses a single contact', async () => {
    const c = await client();
    await c.contacts.get('c-1');
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/contacts/c-1', method: 'GET' });
  });

  it('create() POSTs the contact body', async () => {
    const c = await client();
    await c.contacts.create({ first_name: 'Ann', last_name: 'Smith', email: 'ann@x.io' } as any);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/contacts',
      method: 'POST',
      body: { first_name: 'Ann', last_name: 'Smith', email: 'ann@x.io' },
    });
  });

  it('update() PATCHes only the supplied fields', async () => {
    const c = await client();
    await c.contacts.update('c-1', { email: 'new@x.io' } as any);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/contacts/c-1',
      method: 'PATCH',
      body: { email: 'new@x.io' },
    });
  });

  it('delete() DELETEs the contact', async () => {
    const c = await client();
    await c.contacts.delete('c-1');
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/contacts/c-1', method: 'DELETE' });
  });

  it('addNote() defaults the activity type to "note"', async () => {
    const c = await client();
    await c.contacts.addNote('c-1', 'Called back');
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/contacts/c-1/notes',
      method: 'POST',
      body: { description: 'Called back', type: 'note' },
    });
  });

  it('addNote() honours an explicit type', async () => {
    const c = await client();
    await c.contacts.addNote('c-1', 'Left voicemail', 'call');
    expect(lastRequest().body).toEqual({ description: 'Left voicemail', type: 'call' });
  });
});

describe('deals', () => {
  it('list() passes stage and limit through', async () => {
    const c = await client();
    await c.deals.list({ limit: 10, stage: 'proposal' });
    const { path } = lastRequest();
    expect(path).toContain('limit=10');
    expect(path).toContain('stage=proposal');
  });

  it('get() addresses a single deal', async () => {
    const c = await client();
    await c.deals.get('d-1');
    expect(lastRequest().path).toBe('/api/tenant/deals/d-1');
  });

  it('create() POSTs the deal body', async () => {
    const c = await client();
    await c.deals.create({ title: 'Big one', amount: 5000 } as any);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/deals',
      method: 'POST',
      body: { title: 'Big one', amount: 5000 },
    });
  });

  it('update() can move a deal stage', async () => {
    const c = await client();
    await c.deals.update('d-1', { stage: 'won' });
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/deals/d-1',
      method: 'PATCH',
      body: { stage: 'won' },
    });
  });

  it('delete() DELETEs the deal', async () => {
    const c = await client();
    await c.deals.delete('d-1');
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/deals/d-1', method: 'DELETE' });
  });
});

describe('tasks', () => {
  it('list() forwards limit', async () => {
    const c = await client();
    await c.tasks.list({ limit: 5 });
    expect(lastRequest().path).toContain('limit=5');
  });

  it('create() POSTs the task body', async () => {
    const c = await client();
    await c.tasks.create({ title: 'Follow up' } as any);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/tasks',
      method: 'POST',
      body: { title: 'Follow up' },
    });
  });

  it('complete() PATCHes completed:true', async () => {
    const c = await client();
    await c.tasks.complete('t-1');
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/tasks/t-1',
      method: 'PATCH',
      body: { completed: true },
    });
  });

  it('delete() DELETEs the task', async () => {
    const c = await client();
    await c.tasks.delete('t-1');
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/tasks/t-1', method: 'DELETE' });
  });
});

describe('companies', () => {
  it('list() forwards a search term', async () => {
    const c = await client();
    await c.companies.list({ q: 'acme' });
    expect(lastRequest().path).toContain('q=acme');
  });

  it('create() POSTs the company body', async () => {
    const c = await client();
    await c.companies.create({ name: 'Acme', industry: 'Mining' });
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/companies',
      method: 'POST',
      body: { name: 'Acme', industry: 'Mining' },
    });
  });

  it('update() PATCHes the company', async () => {
    const c = await client();
    await c.companies.update('co-1', { website: 'https://acme.test' });
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/companies/co-1',
      method: 'PATCH',
      body: { website: 'https://acme.test' },
    });
  });
});

describe('search', () => {
  it('global() URL-encodes the query and defaults type to all', async () => {
    const c = await client();
    await c.search.global('ann & bob');
    const { path } = lastRequest();
    expect(path).toContain('q=ann%20%26%20bob');
    expect(path).toContain('type=all');
  });

  it('global() honours an explicit type', async () => {
    const c = await client();
    await c.search.global('acme', 'companies');
    expect(lastRequest().path).toContain('type=companies');
  });
});

describe('webhooks', () => {
  it('list() hits the webhooks collection', async () => {
    const c = await client();
    await c.webhooks.list();
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/webhooks', method: 'GET' });
  });

  it('create() POSTs name, url and events', async () => {
    const c = await client();
    await c.webhooks.create('deal hook', 'https://hooks.test/x', ['deal.created']);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/webhooks',
      method: 'POST',
      body: { name: 'deal hook', url: 'https://hooks.test/x', events: ['deal.created'] },
    });
  });

  it('delete() DELETEs the webhook', async () => {
    const c = await client();
    await c.webhooks.delete('w-1');
    expect(lastRequest()).toMatchObject({ path: '/api/tenant/webhooks/w-1', method: 'DELETE' });
  });
});

describe('forms', () => {
  it('list() hits the forms collection', async () => {
    const c = await client();
    await c.forms.list();
    expect(lastRequest().path).toBe('/api/tenant/forms');
  });

  it('submit() posts to the public endpoint without the Authorization header', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as any);
    const c = await client();
    await c.forms.submit('f-1', { email: 'lead@x.io' });

    const req = lastRequest();
    expect(req.path).toBe('/api/forms/submit');
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ form_id: 'f-1', data: { email: 'lead@x.io' } });
    // Public form ingestion is deliberately unauthenticated — leaking the
    // tenant's API key to an anonymous endpoint would be a real problem.
    expect(req.headers['Authorization']).toBeUndefined();
  });

  it('submit() resolves the raw parsed body and does not throw on non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'validation failed' }),
    } as any);
    const c = await client();
    // submit() bypasses req(), so it has no ok-check: it hands the body back.
    await expect(c.forms.submit('f-1', {})).resolves.toEqual({ error: 'validation failed' });
  });
});

describe('automation', () => {
  it('list() hits the automations collection', async () => {
    const c = await client();
    await c.automation.list();
    expect(lastRequest().path).toBe('/api/tenant/automations');
  });

  it('create() POSTs the automation definition', async () => {
    const c = await client();
    await c.automation.create({
      name: 'Welcome',
      trigger_type: 'contact.created',
      actions: [{ type: 'email' }],
    });
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/automations',
      method: 'POST',
      body: { name: 'Welcome', trigger_type: 'contact.created', actions: [{ type: 'email' }] },
    });
  });

  it('toggle() PATCHes is_active', async () => {
    const c = await client();
    await c.automation.toggle('a-1', false);
    expect(lastRequest()).toMatchObject({
      path: '/api/tenant/automations/a-1',
      method: 'PATCH',
      body: { is_active: false },
    });
  });
});

describe('ping', () => {
  it('reports ok with the tenant id on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tenant_id: 'tenant-3' }),
    } as any);
    const c = await client();
    await expect(c.ping()).resolves.toEqual({ ok: true, tenant: 'tenant-3' });
  });

  it('converts a failure into ok:false plus the message instead of throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid API key' }),
    } as any);
    const c = await client();
    await expect(c.ping()).resolves.toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('surfaces a transport failure as ok:false', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const c = await client();
    await expect(c.ping()).resolves.toEqual({ ok: false, error: 'ECONNREFUSED' });
  });
});

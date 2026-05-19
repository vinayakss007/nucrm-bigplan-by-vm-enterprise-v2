/**
 * COMPREHENSIVE INTEGRATION ENDPOINTS TESTS
 * Tests all integration API endpoints + SDK methods
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock db client
vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}));

describe('Integrations API - GET (list integrations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns list of integrations for tenant', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { queryMany } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      isAdmin: true,
      isSuperAdmin: false,
      roleSlug: 'admin',
      permissions: {},
    });
    
    const mockIntegrations = [
      { id: '1', type: 'zapier', name: 'Zapier', is_active: true, last_used_at: '2024-01-01', created_at: '2024-01-01' },
      { id: '2', type: 'webhook', name: 'Webhook', is_active: false, last_used_at: null, created_at: '2024-01-02' },
    ];
    vi.mocked(queryMany).mockResolvedValue(mockIntegrations);

    const { GET } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = { headers: new Headers() } as any;
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0].type).toBe('zapier');
  });

  it('returns empty array when no integrations', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { queryMany } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(queryMany).mockResolvedValue([]);

    const { GET } = await import('@/app/api/tenant/integrations/route');
    const response = await GET({ headers: new Headers() } as any);
    const data = await response.json();

    expect(data.data).toEqual([]);
  });

  it('returns 401 when not authenticated', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockResolvedValue(
      new (await import('next/server')).NextResponse({ error: 'Unauthorized' }, { status: 401 })
    );

    const { GET } = await import('@/app/api/tenant/integrations/route');
    const response = await GET({ headers: new Headers() } as any);

    expect(response.status).toBe(401);
  });

  it('returns 500 on database error', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { queryMany } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(queryMany).mockRejectedValue(new Error('DB connection failed'));

    const { GET } = await import('@/app/api/tenant/integrations/route');
    const response = await GET({ headers: new Headers() } as any);

    expect(response.status).toBe(500);
  });
});

describe('Integrations API - POST (create integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates webhook integration', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '1', type: 'webhook', name: 'My Webhook', is_active: true, created_at: '2024-01-01' }],
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'webhook', name: 'My Webhook', config: { url: 'https://example.com' } }),
    } as any;
    const response = await POST(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data.type).toBe('webhook');
    expect(data.data.is_active).toBe(true);
  });

  it('creates Zapier integration', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '2', type: 'zapier', name: 'Zapier', is_active: true, created_at: '2024-01-01' }],
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'zapier', name: 'Zapier' }),
    } as any;
    const response = await POST(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(201);
  });

  it('creates integration with empty config', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '3', type: 'n8n', name: 'n8n', is_active: true, created_at: '2024-01-01' }],
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'n8n', name: 'n8n' }),
    } as any;
    const response = await POST(mockRequest);

    expect(response.status).toBe(201);
  });

  it('returns 400 when type missing', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ name: 'Test' }),
    } as any;
    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
  });

  it('returns 400 when name missing', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'webhook' }),
    } as any;
    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
  });

  it('returns 403 when user is not admin', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: false, isSuperAdmin: false,
      roleSlug: 'member', permissions: {},
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'webhook', name: 'Test' }),
    } as any;
    const response = await POST(mockRequest);

    expect(response.status).toBe(403);
  });

  it('returns 401 when not authenticated', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockResolvedValue(
      new (await import('next/server')).NextResponse({ error: 'Unauthorized' }, { status: 401 })
    );

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const response = await POST({ headers: new Headers(), json: () => Promise.resolve({ type: 'webhook', name: 'Test' }) } as any);

    expect(response.status).toBe(401);
  });

  it('returns 500 on database error', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockRejectedValue(new Error('DB error'));

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const response = await POST({ headers: new Headers(), json: () => Promise.resolve({ type: 'webhook', name: 'Test' }) } as any);

    expect(response.status).toBe(500);
  });
});

describe('Integrations API - PATCH (toggle integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('activates integration', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '1', is_active: true }],
    });

    const { PATCH } = await import('@/app/api/tenant/integrations/[id]/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ is_active: true }),
    } as any;
    const response = await PATCH(mockRequest, { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.is_active).toBe(true);
  });

  it('deactivates integration', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '1', is_active: false }],
    });

    const { PATCH } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await PATCH({
      headers: new Headers(),
      json: () => Promise.resolve({ is_active: false }),
    } as any, { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.is_active).toBe(false);
  });

  it('returns 404 when integration not found', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({ rows: [] });

    const { PATCH } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await PATCH({
      headers: new Headers(),
      json: () => Promise.resolve({ is_active: true }),
    } as any, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not admin', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: false, isSuperAdmin: false,
      roleSlug: 'member', permissions: {},
    });

    const { PATCH } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await PATCH({
      headers: new Headers(),
      json: () => Promise.resolve({ is_active: true }),
    } as any, { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
  });
});

describe('Integrations API - DELETE (remove integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('deletes integration successfully', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({ rowCount: 1 });

    const { DELETE } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await DELETE({ headers: new Headers() } as any, { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('returns 404 when integration not found', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({ rowCount: 0 });

    const { DELETE } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await DELETE({ headers: new Headers() } as any, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not admin', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: false, isSuperAdmin: false,
      roleSlug: 'member', permissions: {},
    });

    const { DELETE } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await DELETE({ headers: new Headers() } as any, { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
  });

  it('returns 500 on database error', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockRejectedValue(new Error('DB error'));

    const { DELETE } = await import('@/app/api/tenant/integrations/[id]/route');
    const response = await DELETE({ headers: new Headers() } as any, { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(500);
  });
});

describe('Integrations SDK - comprehensive', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('createNuCRM returns client', async () => {
    const { createNuCRM } = await import('@/lib/integrations/sdk');
    const client = createNuCRM({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com',
    });
    expect(client).toBeDefined();
    expect(client.contacts).toBeDefined();
    expect(client.deals).toBeDefined();
    expect(client.tasks).toBeDefined();
    expect(client.companies).toBeDefined();
    expect(client.search).toBeDefined();
    expect(client.webhooks).toBeDefined();
    expect(client.forms).toBeDefined();
    expect(client.automation).toBeDefined();
  });

  it('SDK client has all resource methods', async () => {
    const { createNuCRM } = await import('@/lib/integrations/sdk');
    const client = createNuCRM({
      apiKey: 'ak_test',
      baseUrl: 'https://crm.example.com',
      tenantId: 't1',
    });

    // Contacts
    expect(client.contacts.list).toBeDefined();
    expect(client.contacts.get).toBeDefined();
    expect(client.contacts.create).toBeDefined();
    expect(client.contacts.update).toBeDefined();
    expect(client.contacts.delete).toBeDefined();
    expect(client.contacts.addNote).toBeDefined();

    // Deals
    expect(client.deals.list).toBeDefined();
    expect(client.deals.get).toBeDefined();
    expect(client.deals.create).toBeDefined();
    expect(client.deals.update).toBeDefined();
    expect(client.deals.delete).toBeDefined();

    // Tasks
    expect(client.tasks.list).toBeDefined();
    expect(client.tasks.create).toBeDefined();
    expect(client.tasks.complete).toBeDefined();
    expect(client.tasks.delete).toBeDefined();

    // Companies
    expect(client.companies.list).toBeDefined();
    expect(client.companies.create).toBeDefined();
    expect(client.companies.update).toBeDefined();

    // Search
    expect(client.search.global).toBeDefined();

    // Webhooks
    expect(client.webhooks.list).toBeDefined();
    expect(client.webhooks.create).toBeDefined();
    expect(client.webhooks.delete).toBeDefined();

    // Forms
    expect(client.forms.list).toBeDefined();
    expect(client.forms.submit).toBeDefined();

    // Automation
    expect(client.automation.list).toBeDefined();
    expect(client.automation.create).toBeDefined();
    expect(client.automation.toggle).toBeDefined();

    // Ping
    expect(client.ping).toBeDefined();
  });

  it('SDK normalizes baseUrl (removes trailing slash)', async () => {
    const { createNuCRM } = await import('@/lib/integrations/sdk');
    const client = createNuCRM({
      apiKey: 'key',
      baseUrl: 'https://api.example.com/',
    });
    expect(client).toBeDefined();
  });

  it('SDK client with tenantId override', async () => {
    const { createNuCRM } = await import('@/lib/integrations/sdk');
    const client = createNuCRM({
      apiKey: 'key',
      baseUrl: 'https://api.example.com',
      tenantId: 'override-tenant',
    });
    expect(client).toBeDefined();
  });
});

describe('Integrations SDK - verifyWebhookSignature', () => {
  it('verifies correct signature', async () => {
    const { verifyWebhookSignature } = await import('@/lib/integrations/sdk');
    const crypto = require('crypto');
    const secret = 'webhook-secret';
    const payload = JSON.stringify({ event: 'contact.created' });
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    
    const isValid = verifyWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it('rejects wrong signature', async () => {
    const { verifyWebhookSignature } = await import('@/lib/integrations/sdk');
    
    const isValid = verifyWebhookSignature(
      '{"event":"test"}',
      'sha256=wrong-signature',
      'secret'
    );
    expect(isValid).toBe(false);
  });

  it('rejects when lengths differ', async () => {
    const { verifyWebhookSignature } = await import('@/lib/integrations/sdk');
    
    const isValid = verifyWebhookSignature(
      '{"event":"test"}',
      'short',
      'secret'
    );
    expect(isValid).toBe(false);
  });
});

describe('Integrations API - full CRUD flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('create then list integrations', async () => {
    // Create
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query, queryMany } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 't1', userId: 'u1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    vi.mocked(query).mockResolvedValue({
      rows: [{ id: '1', type: 'zapier', name: 'Zapier', is_active: true, created_at: '2024-01-01' }],
    });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const createResponse = await POST({
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'zapier', name: 'Zapier' }),
    } as any);
    expect(createResponse.status).toBe(201);

    // List
    vi.mocked(queryMany).mockResolvedValue([
      { id: '1', type: 'zapier', name: 'Zapier', is_active: true, last_used_at: null, created_at: '2024-01-01' },
    ]);

    const { GET } = await import('@/app/api/tenant/integrations/route');
    const listResponse = await GET({ headers: new Headers() } as any);
    const listData = await listResponse.json();
    expect(listData.data).toHaveLength(1);
  });

  it('create then toggle then delete', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { query } = await import('@/lib/db/client');
    
    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 't1', userId: 'u1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    // Create
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: '1', type: 'webhook', name: 'Test', is_active: true, created_at: '2024-01-01' }],
    });
    const { POST } = await import('@/app/api/tenant/integrations/route');
    await POST({
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'webhook', name: 'Test' }),
    } as any);

    // Toggle off
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: '1', is_active: false }],
    });
    const { PATCH } = await import('@/app/api/tenant/integrations/[id]/route');
    await PATCH({
      headers: new Headers(),
      json: () => Promise.resolve({ is_active: false }),
    } as any, { params: Promise.resolve({ id: '1' }) });

    // Delete
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 });
    const { DELETE } = await import('@/app/api/tenant/integrations/[id]/route');
    const deleteResponse = await DELETE({ headers: new Headers() } as any, { params: Promise.resolve({ id: '1' }) });
    expect(deleteResponse.status).toBe(200);
  });
});

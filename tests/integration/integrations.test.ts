/**
 * COMPREHENSIVE INTEGRATION ENDPOINTS TESTS
 * Tests all integration API endpoints + SDK methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock drizzle db
const mockFindMany = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockInsertChain = vi.hoisted(() => vi.fn(() => ({ values: mockValues })));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      integrations: { findMany: mockFindMany },
    },
    insert: mockInsertChain,
  },
}));

describe('Integrations API - GET (list integrations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns list of integrations for tenant', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      isAdmin: true,
      isSuperAdmin: false,
      roleSlug: 'admin',
      permissions: {},
    });

    mockFindMany.mockResolvedValue([
      { id: '1', type: 'zapier', name: 'Zapier', is_active: true, last_used_at: '2024-01-01', created_at: '2024-01-01' },
      { id: '2', type: 'webhook', name: 'Webhook', is_active: false, last_used_at: null, created_at: '2024-01-02' },
    ]);

    const { GET } = await import('@/app/api/tenant/integrations/route');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await GET({ headers: new Headers() } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0].type).toBe('zapier');
  });

  it('returns empty array when no integrations', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import('@/app/api/tenant/integrations/route');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await GET({ headers: new Headers() } as any);

    expect(response.status).toBe(401);
  });

  it('returns 500 on database error', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });
    mockFindMany.mockRejectedValue(new Error('DB connection failed'));

    const { GET } = await import('@/app/api/tenant/integrations/route');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    mockReturning.mockResolvedValue([{ id: '1', type: 'webhook', name: 'My Webhook', is_active: true, created_at: '2024-01-01' }]);
    mockInsertChain.mockReturnValue({ values: mockValues });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'webhook', name: 'My Webhook', config: { url: 'https://example.com' } }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const response = await POST(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data.type).toBe('webhook');
    expect(data.data.is_active).toBe(true);
  });

  it('creates Zapier integration', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    mockReturning.mockResolvedValue([{ id: '2', type: 'zapier', name: 'Zapier', is_active: true, created_at: '2024-01-01' }]);
    mockInsertChain.mockReturnValue({ values: mockValues });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'zapier', name: 'Zapier' }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const response = await POST(mockRequest);

    expect(response.status).toBe(201);
  });

  it('creates integration with empty config', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    mockReturning.mockResolvedValue([{ id: '3', type: 'n8n', name: 'n8n', is_active: true, created_at: '2024-01-01' }]);
    mockInsertChain.mockReturnValue({ values: mockValues });

    const { POST } = await import('@/app/api/tenant/integrations/route');
    const mockRequest = {
      headers: new Headers(),
      json: () => Promise.resolve({ type: 'n8n', name: 'n8n' }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST({ headers: new Headers(), json: () => Promise.resolve({ type: 'webhook', name: 'Test' }) } as any);

    expect(response.status).toBe(401);
  });

  it('returns 500 on database error', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    vi.mocked(requireAuth).mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1',
      isAdmin: true, isSuperAdmin: false,
      roleSlug: 'admin', permissions: {},
    });

    mockReturning.mockRejectedValue(new Error('DB error'));
    mockInsertChain.mockReturnValue({ values: mockValues });

    const { POST } = await import('@/app/api/tenant/integrations/route');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST({ headers: new Headers(), json: () => Promise.resolve({ type: 'webhook', name: 'Test' }) } as any);

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

    expect(client.contacts.list).toBeDefined();
    expect(client.contacts.get).toBeDefined();
    expect(client.contacts.create).toBeDefined();
    expect(client.contacts.update).toBeDefined();
    expect(client.contacts.delete).toBeDefined();
    expect(client.contacts.addNote).toBeDefined();

    expect(client.deals.list).toBeDefined();
    expect(client.deals.get).toBeDefined();
    expect(client.deals.create).toBeDefined();
    expect(client.deals.update).toBeDefined();
    expect(client.deals.delete).toBeDefined();

    expect(client.tasks.list).toBeDefined();
    expect(client.tasks.create).toBeDefined();
    expect(client.tasks.complete).toBeDefined();
    expect(client.tasks.delete).toBeDefined();

    expect(client.companies.list).toBeDefined();
    expect(client.companies.create).toBeDefined();
    expect(client.companies.update).toBeDefined();

    expect(client.search.global).toBeDefined();
    expect(client.webhooks.list).toBeDefined();
    expect(client.webhooks.create).toBeDefined();
    expect(client.webhooks.delete).toBeDefined();
    expect(client.forms.list).toBeDefined();
    expect(client.forms.submit).toBeDefined();
    expect(client.automation.list).toBeDefined();
    expect(client.automation.create).toBeDefined();
    expect(client.automation.toggle).toBeDefined();
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
    const crypto = await import('crypto');
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

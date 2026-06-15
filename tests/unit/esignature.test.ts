import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    query: {
      signingRequests: { findFirst: vi.fn() },
      signingEvents: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/drizzle/schema/esignature', () => ({
  signingRequests: { id: 'id', tenantId: 'tenant_id', externalId: 'external_id', provider: 'provider', status: 'status' },
  signingEvents: { id: 'id', requestId: 'request_id', tenantId: 'tenant_id', event: 'event', signerEmail: 'signer_email' },
}));

vi.mock('drizzle-orm', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq: vi.fn((...args: any[]) => ['eq', ...args]),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  and: vi.fn((...args: any[]) => ['and', ...args]),
  sql: vi.fn(),
}));

vi.mock('crypto', () => ({
  createHmac: vi.fn(() => ({
    update: vi.fn(() => ({
      digest: vi.fn((_encoding: string) => 'mocked-digest'),
    })),
  })),
}));

import { db } from '@/drizzle/db';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('E-Signature - Provider Adapter Factory', () => {
  it('returns InternalAdapter for internal provider', async () => {
    const { getProviderAdapter, InternalAdapter } = await import('@/lib/esignature');
    const adapter = getProviderAdapter('internal');
    expect(adapter).toBeInstanceOf(InternalAdapter);
  });

  it('returns DocuSignAdapter for docusign provider', async () => {
    const { getProviderAdapter, DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = getProviderAdapter('docusign');
    expect(adapter).toBeInstanceOf(DocuSignAdapter);
  });

  it('returns HelloSignAdapter for hellosign provider', async () => {
    const { getProviderAdapter, HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = getProviderAdapter('hellosign');
    expect(adapter).toBeInstanceOf(HelloSignAdapter);
  });

  it('throws for unknown provider', async () => {
    const { getProviderAdapter } = await import('@/lib/esignature');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getProviderAdapter('unknown' as any)).toThrow('Unsupported signing provider');
  });
});

describe('E-Signature - InternalAdapter', () => {
  it('creates a request with internal prefix', async () => {
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    const result = await adapter.createRequest({
      documentId: 'doc-1', signers: [{ email: 'test@example.com', name: 'Test' }],
      provider: 'internal', tenantId: 'tenant-1',
    });

    expect(result.externalId).toMatch(/^internal-/);
  });

  it('getStatus always returns pending', async () => {
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    const status = await adapter.getStatus('any-id');

    expect(status).toBe('pending');
  });

  it('validateWebhook always returns true', async () => {
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    expect(adapter.validateWebhook({}, {})).toBe(true);
    expect(adapter.validateWebhook(null, {})).toBe(true);
  });
});

describe('E-Signature - DocuSignAdapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates request via DocuSign API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopeId: 'ds-env-123' }),
    });

    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();
    const result = await adapter.createRequest({
      documentId: 'doc-1', signers: [{ email: 'a@b.com', name: 'Alice' }],
      provider: 'docusign', tenantId: 't-1',
    });

    expect(result.externalId).toBe('ds-env-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on API error during create', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    await expect(adapter.createRequest({
      documentId: 'doc-1', signers: [], provider: 'docusign', tenantId: 't-1',
    })).rejects.toThrow('DocuSign API error');
  });

  it('gets status from DocuSign API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'completed' }),
    });

    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();
    const status = await adapter.getStatus('ext-123');

    expect(status).toBe('signed');
  });

  it('throws on API error during getStatus', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    await expect(adapter.getStatus('ext-123')).rejects.toThrow('DocuSign API error');
  });

  it('validateWebhook returns false when no signature header', async () => {
    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    expect(adapter.validateWebhook({}, {})).toBe(false);
  });

  it('validateWebhook falls back to presence check when no secret', async () => {
    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    expect(adapter.validateWebhook('payload', { 'x-docusign-signature-1': 'abc123' })).toBe(true);
  });

  it('validateWebhook verifies HMAC when secret is set', async () => {
    process.env['DOCUSIGN_WEBHOOK_SECRET'] = 'test-secret';
    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    const result = adapter.validateWebhook('{"event":"signed"}', { 'x-docusign-signature-1': 'mocked-digest' });

    expect(result).toBe(true);
    delete process.env['DOCUSIGN_WEBHOOK_SECRET'];
  });
});

describe('E-Signature - HelloSignAdapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates request via HelloSign API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ signature_request: { signature_request_id: 'hs-req-123' } }),
    });

    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();
    const result = await adapter.createRequest({
      documentId: 'doc-1', signers: [{ email: 'a@b.com', name: 'Alice' }],
      provider: 'hellosign', tenantId: 't-1',
    });

    expect(result.externalId).toBe('hs-req-123');
  });

  it('throws on API error during create', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    await expect(adapter.createRequest({
      documentId: 'doc-1', signers: [], provider: 'hellosign', tenantId: 't-1',
    })).rejects.toThrow('HelloSign API error');
  });

  it('gets status from HelloSign API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ signature_request: { status_code: 'signed' } }),
    });

    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();
    const status = await adapter.getStatus('ext-456');

    expect(status).toBe('signed');
  });

  it('throws on API error during getStatus', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    await expect(adapter.getStatus('ext-456')).rejects.toThrow('HelloSign API error');
  });

  it('validateWebhook returns false when no event hash header', async () => {
    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    expect(adapter.validateWebhook({}, {})).toBe(false);
  });

  it('validateWebhook falls back to presence check when no secret', async () => {
    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    expect(adapter.validateWebhook('payload', { 'x-hellosign-event-hash': 'abc123' })).toBe(true);
  });

  it('validateWebhook verifies HMAC when secret is set', async () => {
    process.env['HELLOSIGN_WEBHOOK_SECRET'] = 'test-secret';
    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    const result = adapter.validateWebhook('{"event":"signed"}', { 'x-hellosign-event-hash': 'mocked-digest' });

    expect(result).toBe(true);
    delete process.env['HELLOSIGN_WEBHOOK_SECRET'];
  });
});

describe('E-Signature - createSigningRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a signing request and returns structured result', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 'req-1', tenantId: 'tenant-1', documentId: 'doc-1',
          provider: 'internal', status: 'sent', externalId: 'internal-123',
          signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
          metadata: {},
        }]),
      }),
    });

    const { createSigningRequest } = await import('@/lib/esignature');
    const result = await createSigningRequest({
      documentId: 'doc-1', signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
      provider: 'internal', tenantId: 'tenant-1',
    });

    expect(result.id).toBe('req-1');
    expect(result.provider).toBe('internal');
    expect(result.status).toBe('sent');
    expect(result.documentId).toBe('doc-1');
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles multiple signers', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 'req-2', tenantId: 'tenant-1', documentId: 'doc-2',
          provider: 'internal', status: 'sent', externalId: 'internal-456',
          signers: [{ email: 'a@b.com', name: 'A' }, { email: 'c@d.com', name: 'C' }],
          metadata: {},
        }]),
      }),
    });

    const { createSigningRequest } = await import('@/lib/esignature');
    const result = await createSigningRequest({
      documentId: 'doc-2',
      signers: [{ email: 'a@b.com', name: 'A' }, { email: 'c@d.com', name: 'C' }],
      provider: 'internal', tenantId: 'tenant-1',
    });

    expect(result.signers).toHaveLength(2);
  });
});

describe('E-Signature - getSigningStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns signing request when found', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', documentId: 'doc-1',
      provider: 'internal', status: 'signed', externalId: 'ext-1',
      signers: [{ email: 'a@b.com', name: 'A' }], metadata: { key: 'val' },
    });

    const { getSigningStatus } = await import('@/lib/esignature');
    const result = await getSigningStatus('req-1', 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('req-1');
    expect(result!.status).toBe('signed');
  });

  it('returns null when request not found', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue(null);

    const { getSigningStatus } = await import('@/lib/esignature');
    const result = await getSigningStatus('non-existent', 'tenant-1');

    expect(result).toBeNull();
  });

  it('handles null signers gracefully', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', documentId: 'doc-1',
      provider: 'internal', status: 'pending', externalId: null,
      signers: null, metadata: null,
    });

    const { getSigningStatus } = await import('@/lib/esignature');
    const result = await getSigningStatus('req-1', 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.signers).toEqual([]);
    expect(result!.metadata).toEqual({});
  });
});

describe('E-Signature - handleSigningWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns updated:false when request not found', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue(null);

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'docusign', externalId: 'non-existent', event: 'signed',
      signerEmail: 'test@example.com',
    });

    expect(result.updated).toBe(false);
  });

  it('updates status when request found and records event', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', status: 'sent',
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
      }),
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'event-1' }]),
      }),
    });

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'docusign', externalId: 'ext-123', event: 'signed',
      signerEmail: 'signer@example.com',
    });

    expect(result.updated).toBe(true);
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles viewed webhook event', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', status: 'sent',
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'ev-1' }]) }),
    });

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'hellosign', externalId: 'ext-456', event: 'viewed',
      signerEmail: 'viewer@example.com',
    });

    expect(result.updated).toBe(true);
  });

  it('handles declined webhook event', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', status: 'sent',
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'ev-2' }]) }),
    });

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'docusign', externalId: 'ext-789', event: 'declined',
    });

    expect(result.updated).toBe(true);
  });
});

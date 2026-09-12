import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxReturning = vi.fn();
const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
const mockTxUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })) })) })),
    query: {
      signingRequests: { findFirst: vi.fn(), findMany: vi.fn() },
      signingEvents: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return await cb({ insert: mockTxInsert, update: mockTxUpdate });
    }),
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

let _tokenCounter = 0;
vi.mock('crypto', () => ({
  createHmac: vi.fn(() => ({
    update: vi.fn(() => ({
      digest: vi.fn((_encoding: string) => 'mocked-digest'),
    })),
  })),
  // Deterministic per-call token so tests can assert distinct signer tokens.
  randomBytes: vi.fn((_n: number) => ({
    toString: (_enc: string) => `tok${++_tokenCounter}`,
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

  it('getStatus derives status from the persisted request (#1613)', async () => {
    (db.query.signingRequests.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'signed' });
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    expect(await adapter.getStatus('internal-abc')).toBe('signed');
  });

  it('getStatus falls back to pending when the request is unknown', async () => {
    (db.query.signingRequests.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    expect(await adapter.getStatus('missing')).toBe('pending');
  });

  it('validateWebhook rejects — the internal provider has no external webhook (#1613)', async () => {
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    expect(adapter.validateWebhook({}, {})).toBe(false);
    expect(adapter.validateWebhook(null, {})).toBe(false);
  });

  it('createRequest mints an unguessable internal external id', async () => {
    const { InternalAdapter } = await import('@/lib/esignature');
    const adapter = new InternalAdapter();
    const r = await adapter.createRequest({
      documentId: 'd', signers: [{ email: 'a@b.com', name: 'A' }], provider: 'internal', tenantId: 't',
    });
    expect(r.externalId).toMatch(/^internal-/);
  });
});

describe('E-Signature - internal signer flow (#1613)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('createSigningRequest mints a per-signer token for the internal provider', async () => {
    mockTxReturning.mockResolvedValue([{
      id: 'req-1', tenantId: 't-1', documentId: 'd-1', provider: 'internal',
      status: 'sent', externalId: 'internal-x', signers: [], metadata: {},
    }]);
    const { createSigningRequest } = await import('@/lib/esignature');
    const result = await createSigningRequest({
      documentId: 'd-1', signers: [{ email: 'a@b.com', name: 'A' }, { email: 'c@d.com', name: 'C' }],
      provider: 'internal', tenantId: 't-1',
    });
    expect(result.signers).toHaveLength(2);
    expect(result.signers[0]!.token).toBeTruthy();
    expect(result.signers[1]!.token).toBeTruthy();
    expect(result.signers[0]!.token).not.toBe(result.signers[1]!.token);
  });

  it('getInternalSigningByToken resolves the matching signer', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'sent', externalId: 'e1',
        signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }], metadata: {} },
    ]);
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    const view = await getInternalSigningByToken('TOKEN-A');
    expect(view).not.toBeNull();
    expect(view!.signer.email).toBe('a@b.com');
    expect(view!.alreadyResolved).toBe(false);
  });

  it('getInternalSigningByToken returns null for an unknown token', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'sent', externalId: 'e1',
        signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }], metadata: {} },
    ]);
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    expect(await getInternalSigningByToken('nope')).toBeNull();
    expect(await getInternalSigningByToken('')).toBeNull();
  });

  it('recordInternalSignerEvent marks the request signed once all signers sign', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'viewed', externalId: 'e1',
        signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }], metadata: {} },
    ]);
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'signed');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('signed');
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it('recordInternalSignerEvent declines the whole request on any decline', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'sent', externalId: 'e1',
        signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }, { email: 'c@d.com', name: 'C', token: 'TOKEN-C' }], metadata: {} },
    ]);
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'declined');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('declined');
  });

  it('recordInternalSignerEvent is idempotent for an already-resolved signer', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'signed', externalId: 'e1',
        signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A', signedAt: '2026-01-01T00:00:00Z' }], metadata: {} },
    ]);
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'signed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already_resolved');
  });

  it('recordInternalSignerEvent returns not_found for an unknown token', async () => {
    (db.query.signingRequests.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('missing', 'signed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_found');
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

  it('validateWebhook fails closed (rejects) when no secret is configured', async () => {
    delete process.env['DOCUSIGN_WEBHOOK_SECRET'];
    const { DocuSignAdapter } = await import('@/lib/esignature');
    const adapter = new DocuSignAdapter();

    // A presence check proves nothing without a secret to verify against.
    expect(adapter.validateWebhook('payload', { 'x-docusign-signature-1': 'abc123' })).toBe(false);
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

  it('validateWebhook fails closed (rejects) when no secret is configured', async () => {
    delete process.env['HELLOSIGN_WEBHOOK_SECRET'];
    const { HelloSignAdapter } = await import('@/lib/esignature');
    const adapter = new HelloSignAdapter();

    // A presence check proves nothing without a secret to verify against.
    expect(adapter.validateWebhook('payload', { 'x-hellosign-event-hash': 'abc123' })).toBe(false);
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
    mockTxReturning.mockResolvedValue([{
      id: 'req-1', tenantId: 'tenant-1', documentId: 'doc-1',
      provider: 'internal', status: 'sent', externalId: 'internal-123',
      signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
      metadata: {},
    }]);

    const { createSigningRequest } = await import('@/lib/esignature');
    const result = await createSigningRequest({
      documentId: 'doc-1', signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
      provider: 'internal', tenantId: 'tenant-1',
    });

    expect(result.id).toBe('req-1');
    expect(result.provider).toBe('internal');
    expect(result.status).toBe('sent');
    expect(result.documentId).toBe('doc-1');
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it('handles multiple signers', async () => {
    mockTxReturning.mockResolvedValue([{
      id: 'req-2', tenantId: 'tenant-1', documentId: 'doc-2',
      provider: 'internal', status: 'sent', externalId: 'internal-456',
      signers: [{ email: 'a@b.com', name: 'A' }, { email: 'c@d.com', name: 'C' }],
      metadata: {},
    }]);

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

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'docusign', externalId: 'ext-123', event: 'signed',
      signerEmail: 'signer@example.com',
    });

    expect(result.updated).toBe(true);
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it('handles viewed webhook event', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1', tenantId: 'tenant-1', status: 'sent',
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

    const { handleSigningWebhook } = await import('@/lib/esignature');
    const result = await handleSigningWebhook({
      provider: 'docusign', externalId: 'ext-789', event: 'declined',
    });

    expect(result.updated).toBe(true);
  });
});

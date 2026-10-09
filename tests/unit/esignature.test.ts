import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxReturning = vi.fn();
const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
const mockTxUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));

// #2380: getInternalSigningByToken now requires the signer link's document to
// be live (documents.deleted_at IS NULL). Default to live so the pre-existing
// internal-flow tests keep testing the flow; the deleted case is covered in
// tests/unit/esignature-deleted-document-2380.test.ts.
const mockLiveDocuments = { current: [{ id: 'doc-live', name: 'Proposal.pdf' }] as unknown[] };

// #2468: the signer lookup is no longer a 500-row JS scan on the pool — it is one
// `SELECT … WHERE signers @> jsonb_build_array(jsonb_build_object('token', …))`
// inside a transaction that carries the credential GUC. The mock stands in for
// Postgres here: the row it hands back is whatever the test says the containment
// admitted.
const mockInternalRows = { current: [] as unknown[] };
const mockTxSigningRequestFindFirst = vi.fn(async () => mockInternalRows.current[0] ?? null);
// every `SELECT set_config(…)` issued on a transaction handle, in order, with the
// GUC name as its first interpolated value
const mockTxExecutes: unknown[] = [];
const mockTxExecute = vi.fn(async (statement: unknown) => {
  mockTxExecutes.push(statement);
  return undefined;
});

// One awaitable chain that answers both shapes the internal flow reads with:
// `tx.select().from(documents).where(…).limit(1)` and
// `tx.select().from(signing_events).where(…).orderBy(…)`.
function makeTxSelectChain() {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve([]),
  };
  chain.limit = () => Promise.resolve(mockLiveDocuments.current);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(mockLiveDocuments.current).then(res);
  return chain;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => []),
          limit: vi.fn(async () => mockLiveDocuments.current),
        })),
      })),
    })),
    query: {
      signingRequests: { findFirst: vi.fn(), findMany: vi.fn() },
      signingEvents: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return await cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
        select: () => makeTxSelectChain(),
        execute: mockTxExecute,
        query: { signingRequests: { findFirst: mockTxSigningRequestFindFirst } },
      });
    }),
  },
}));

vi.mock('@/drizzle/schema/documents', () => ({
  documents: { id: 'id', name: 'name', deletedAt: 'deleted_at' },
}));

vi.mock('@/drizzle/schema/esignature', () => ({
  signingRequests: { id: 'id', tenantId: 'tenant_id', externalId: 'external_id', provider: 'provider', status: 'status', signers: 'signers', documentId: 'document_id', createdAt: 'created_at' },
  signingEvents: { id: 'id', requestId: 'request_id', tenantId: 'tenant_id', event: 'event', signerEmail: 'signer_email' },
}));

vi.mock('drizzle-orm', () => {
  // `sql.join` has to exist for the portal-lookup statement builder, which splices
  // one set_config per GUC into a single statement (PP-028: each extra round trip
  // measured ~200 ms). The template tag keeps the interpolated values so a test can
  // read which GUC carried which credential — the mock pool ignores the shape.
  const sqlMock = Object.assign(
    vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
    { join: vi.fn((parts: unknown, sep: unknown) => [parts, sep]) },
  );
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eq: vi.fn((...args: any[]) => ['eq', ...args]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    and: vi.fn((...args: any[]) => ['and', ...args]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    asc: vi.fn((...args: any[]) => ['asc', ...args]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    desc: vi.fn((...args: any[]) => ['desc', ...args]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isNull: vi.fn((...args: any[]) => ['isNull', ...args]),
    sql: sqlMock,
  };
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockInternalRows.current = [];
    mockLiveDocuments.current = [{ id: 'doc-live', name: 'Proposal.pdf' }];
    mockTxExecutes.length = 0;
  });

  // The row Postgres' containment predicate admits for a valid signer token.
  function matchedRow(overrides: Record<string, unknown> = {}) {
    mockInternalRows.current = [{
      id: 'r1', tenantId: 't1', documentId: 'd1', provider: 'internal', status: 'sent', externalId: 'e1',
      signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }], metadata: {},
      ...overrides,
    }];
  }

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
    matchedRow();
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    const view = await getInternalSigningByToken('TOKEN-A');
    expect(view).not.toBeNull();
    expect(view!.signer.email).toBe('a@b.com');
    expect(view!.alreadyResolved).toBe(false);
    expect(view!.documentName).toBe('Proposal.pdf');
  });

  it('getInternalSigningByToken returns null for an unknown token', async () => {
    matchedRow();
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    // a row that carries no such signer — defence in depth behind the SQL predicate
    expect(await getInternalSigningByToken('nope')).toBeNull();
    // an empty token never reaches the database at all
    expect(await getInternalSigningByToken('')).toBeNull();
  });

  it('recordInternalSignerEvent marks the request signed once all signers sign', async () => {
    matchedRow({ status: 'viewed' });
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'signed');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('signed');
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it('recordInternalSignerEvent declines the whole request on any decline', async () => {
    matchedRow({
      signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }, { email: 'c@d.com', name: 'C', token: 'TOKEN-C' }],
    });
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'declined');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('declined');
  });

  it('recordInternalSignerEvent is idempotent for an already-resolved signer', async () => {
    matchedRow({
      status: 'signed',
      signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A', signedAt: '2026-01-01T00:00:00Z' }],
    });
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'signed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already_resolved');
    // no second event row, no re-stamped status
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it('recordInternalSignerEvent returns not_found when the credential matches no request', async () => {
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('missing', 'signed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_found');
  });
});

describe('E-Signature - the internal signer flow runs in a RLS context (#2468)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInternalRows.current = [];
    mockLiveDocuments.current = [{ id: 'doc-live', name: 'Proposal.pdf' }];
    mockTxExecutes.length = 0;
  });

  function matchedRow() {
    mockInternalRows.current = [{
      id: 'r1', tenantId: '11111111-1111-4111-8111-111111111111', documentId: 'd1',
      provider: 'internal', status: 'sent', externalId: 'e1',
      signers: [{ email: 'a@b.com', name: 'A', token: 'TOKEN-A' }], metadata: {},
    }];
  }

  it('names the credential in the lookup GUC before the signing_requests read', async () => {
    matchedRow();
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    const view = await getInternalSigningByToken('TOKEN-A');
    expect(view).not.toBeNull();

    // #2468: the row that says which workspace a signing link belongs to is the
    // row the link authenticates with, so it cannot be tenant-scoped. It is
    // admitted by 0123's credential arm instead.
    expect(mockTxSigningRequestFindFirst).toHaveBeenCalledTimes(1);
    const gucs = mockTxExecutes.map((s) => JSON.stringify(s));
    expect(gucs[0]).toContain('app.portal_lookup_token');
    expect(gucs[0]).toContain('TOKEN-A');
    // …and the tenant GUC is set only once the row names the workspace, on the
    // same handle, in the same transaction.
    expect(gucs[1]).toContain('app.current_tenant');
    expect(gucs[1]).toContain('11111111-1111-4111-8111-111111111111');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('matches the credential in SQL instead of scanning requests in JS', async () => {
    matchedRow();
    const { sql } = await import('drizzle-orm');
    await (await import('@/lib/esignature')).getInternalSigningByToken('TOKEN-A');
    const fragments = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(JSON.stringify(fragments)).toContain('@>');
    expect(JSON.stringify(fragments)).toContain('jsonb_build_object');
    expect(JSON.stringify(fragments)).toContain('TOKEN-A');
  });

  it('writes the event through a context-bound handle, not the bare pool', async () => {
    matchedRow();
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent('TOKEN-A', 'signed');
    expect(res.ok).toBe(true);

    // one transaction to resolve the credential, one to write in its workspace
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxInsert).toHaveBeenCalledTimes(1);
    expect(mockTxExecutes.some((s) => JSON.stringify(s).includes('app.current_tenant'))).toBe(true);
  });

  it('listSigningEvents reads through the caller\'s handle', async () => {
    const { listSigningEvents } = await import('@/lib/esignature');
    const handle = { select: () => makeTxSelectChain() };
    const events = await listSigningEvents(handle as never, 'r1');
    expect(events).toEqual([]);
    // the pool is never touched: a public route hands this a bound transaction
    expect(db.select).not.toHaveBeenCalled();
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

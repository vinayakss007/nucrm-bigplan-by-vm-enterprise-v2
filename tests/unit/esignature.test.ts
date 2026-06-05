import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProviderAdapter,
  InternalAdapter,
  DocuSignAdapter,
  HelloSignAdapter,
  handleSigningWebhook,
  createSigningRequest,
  getSigningStatus,
} from '@/lib/esignature';

// Mock DB
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 'req-1',
          tenantId: 'tenant-1',
          documentId: 'doc-1',
          provider: 'internal',
          status: 'sent',
          externalId: 'internal-123',
          signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
          metadata: {},
        }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
        }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
    query: {
      signingRequests: {
        findFirst: vi.fn(),
      },
      signingEvents: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@/drizzle/schema/esignature', () => ({
  signingRequests: { id: 'id', tenantId: 'tenant_id', externalId: 'external_id', provider: 'provider', status: 'status' },
  signingEvents: { id: 'id', requestId: 'request_id', tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  sql: vi.fn(),
}));

import { db } from '@/drizzle/db';

describe('E-Signature - Provider Adapter Factory', () => {
  it('returns InternalAdapter for internal provider', () => {
    const adapter = getProviderAdapter('internal');
    expect(adapter).toBeInstanceOf(InternalAdapter);
  });

  it('returns DocuSignAdapter for docusign provider', () => {
    const adapter = getProviderAdapter('docusign');
    expect(adapter).toBeInstanceOf(DocuSignAdapter);
  });

  it('returns HelloSignAdapter for hellosign provider', () => {
    const adapter = getProviderAdapter('hellosign');
    expect(adapter).toBeInstanceOf(HelloSignAdapter);
  });

  it('throws for unknown provider', () => {
    expect(() => getProviderAdapter('unknown' as any)).toThrow('Unsupported signing provider');
  });
});

describe('E-Signature - InternalAdapter', () => {
  it('creates a request with internal prefix', async () => {
    const adapter = new InternalAdapter();
    const result = await adapter.createRequest({
      documentId: 'doc-1',
      signers: [{ email: 'test@example.com', name: 'Test' }],
      provider: 'internal',
      tenantId: 'tenant-1',
    });

    expect(result.externalId).toMatch(/^internal-/);
  });

  it('validates webhooks always as true', () => {
    const adapter = new InternalAdapter();
    const valid = adapter.validateWebhook({}, {});
    expect(valid).toBe(true);
  });
});

describe('E-Signature - createSigningRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the insert mock chain
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 'req-1',
          tenantId: 'tenant-1',
          documentId: 'doc-1',
          provider: 'internal',
          status: 'sent',
          externalId: 'internal-123',
          signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
          metadata: {},
        }]),
      }),
    });
  });

  it('creates a signing request and returns structured result', async () => {
    const result = await createSigningRequest({
      documentId: 'doc-1',
      signers: [{ email: 'signer@test.com', name: 'Test Signer' }],
      provider: 'internal',
      tenantId: 'tenant-1',
    });

    expect(result.id).toBe('req-1');
    expect(result.provider).toBe('internal');
    expect(result.status).toBe('sent');
    expect(result.documentId).toBe('doc-1');
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('E-Signature - handleSigningWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns updated:false when request not found', async () => {
    (db.query.signingRequests.findFirst as any).mockResolvedValue(null);

    const result = await handleSigningWebhook({
      provider: 'docusign',
      externalId: 'non-existent',
      event: 'signed',
      signerEmail: 'test@example.com',
    });

    expect(result.updated).toBe(false);
  });

  it('updates status when request found', async () => {
    (db.query.signingRequests.findFirst as any).mockResolvedValue({
      id: 'req-1',
      tenantId: 'tenant-1',
      status: 'sent',
    });
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'event-1' }]),
      }),
    });

    const result = await handleSigningWebhook({
      provider: 'docusign',
      externalId: 'ext-123',
      event: 'signed',
      signerEmail: 'signer@example.com',
    });

    expect(result.updated).toBe(true);
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });
});

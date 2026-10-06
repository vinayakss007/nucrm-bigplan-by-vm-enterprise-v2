/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspect } from 'util';

// #2380: deleting a document must kill its public signing link. The tenant
// DELETE handler only stamps documents.deleted_at, and RLS scopes by tenant
// only, so the app role keeps reading soft-deleted rows. getInternalSigningByToken
// is the single gate behind BOTH GET /api/public/sign/[token] and its POST,
// so these tests pin the predicate there and prove the write path never starts.

const mockState = {
  rows: [] as unknown[],
  documentRows: [] as unknown[],
  capturedWhere: [] as unknown[],
  transaction: vi.fn(),
  findMany: vi.fn(),
  selectCall: 0,
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      signingRequests: { findMany: (...a: unknown[]) => mockState.findMany(...a) },
    },
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (...a: unknown[]) => { mockState.capturedWhere.push(a[0]); return chain; },
        limit: () => Promise.resolve(mockState.documentRows),
        then: (res: (v: unknown) => unknown) => Promise.resolve(mockState.documentRows).then(res),
      };
      mockState.selectCall++;
      return chain;
    }),
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => mockState.transaction(cb)),
  },
}));

const DOC_ID = '22222222-2222-4222-8222-222222222222';
const REQ_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'abcdef0123456789abcdef0123456789';

function internalRow(signers: unknown[]) {
  return {
    id: REQ_ID,
    tenantId: '11111111-1111-4111-8111-111111111111',
    documentId: DOC_ID,
    provider: 'internal',
    status: 'sent',
    externalId: null,
    signers,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.rows = [];
  mockState.documentRows = [{ id: DOC_ID }];
  mockState.capturedWhere = [];
  mockState.selectCall = 0;
  mockState.findMany.mockImplementation(async () => mockState.rows);
  mockState.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({ values: () => Promise.resolve([]) }),
    }),
  );
});

describe('getInternalSigningByToken — soft-deleted document kills the link (#2380)', () => {
  it('requires documents.deleted_at IS NULL on the matched request', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    const view = await getInternalSigningByToken(TOKEN);
    expect(view).not.toBeNull();
    expect(mockState.capturedWhere).toHaveLength(1);
    const text = inspect(mockState.capturedWhere[0], { depth: 14 });
    expect(text).toContain('deleted_at');
    expect(text).toMatch(/is null/i);
  });

  it('returns null when the document is soft-deleted', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    mockState.documentRows = [];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    expect(await getInternalSigningByToken(TOKEN)).toBeNull();
  });

  it('does not read documents for a token that matches no signer', async () => {
    mockState.rows = [internalRow([{ token: 'other-token-value-1234', name: 'A', email: 'a@b.com' }])];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    expect(await getInternalSigningByToken(TOKEN)).toBeNull();
    expect(mockState.selectCall).toBe(0);
  });
});

describe('POST /api/public/sign/[token] against a deleted document (#2380)', () => {
  it('reports not_found and never opens its transaction', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    mockState.documentRows = [];
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent(TOKEN, 'signed');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    // no signing_events row, no status rollup
    expect(mockState.transaction).not.toHaveBeenCalled();
  });

  it('still records the event for a live document', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent(TOKEN, 'signed');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('signed');
    expect(mockState.transaction).toHaveBeenCalledTimes(1);
  });
});

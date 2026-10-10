/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspect } from 'util';
import { getTableName } from 'drizzle-orm';

// #2380: deleting a document must kill its public signing link. The tenant
// DELETE handler only stamps documents.deleted_at, and RLS scopes by tenant
// only, so the app role keeps reading soft-deleted rows. getInternalSigningByToken
// is the single gate behind BOTH GET /api/public/sign/[token] and its POST,
// so these tests pin the predicate there and prove the write path never starts.
//
// #2468 moved that gate off the bare pool onto the transaction that resolves the
// signer credential, so the handles here are the transaction's: `tx.query`,
// `tx.select`, `tx.execute`, `tx.update`, `tx.insert`. #2380's own assertions are
// unchanged — the gate reads the same predicate, it just finally runs somewhere
// RLS admits a row.

const mockState = {
  // what the credential containment predicate admits, newest first
  rows: [] as unknown[],
  documentRows: [] as unknown[],
  capturedWhere: [] as unknown[],
  capturedLookupWhere: [] as unknown[],
  transaction: vi.fn(),
  findFirst: vi.fn(),
  selectCall: 0,
  // every statement run on a transaction handle — the set_config calls
  executes: [] as unknown[],
  updates: [] as string[],
  inserts: [] as string[],
};

vi.mock('@/drizzle/db', () => ({
  db: {
    // The bare pool. #2468 is exactly about this flow not using it, so every
    // spy here is a tripwire: touching the pool from a public signing request
    // throws instead of quietly reading zero rows (or, pre-0123, everything).
    query: {
      signingRequests: {
        findMany: () => { throw new Error('public signing flow read signingRequests on the bare pool'); },
        findFirst: () => { throw new Error('public signing flow read signingRequests on the bare pool'); },
      },
    },
    select: () => { throw new Error('public signing flow read on the bare pool'); },
    update: () => { throw new Error('public signing flow wrote on the bare pool'); },
    insert: () => { throw new Error('public signing flow wrote on the bare pool'); },
    transaction: (cb: (tx: unknown) => Promise<unknown>) => mockState.transaction(cb),
  },
}));

const DOC_ID = '22222222-2222-4222-8222-222222222222';
const REQ_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'abcdef0123456789abcdef0123456789';

function internalRow(signers: unknown[]) {
  return {
    id: REQ_ID,
    tenantId: TENANT_ID,
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
  mockState.documentRows = [{ id: DOC_ID, name: 'Proposal.pdf' }];
  mockState.capturedWhere = [];
  mockState.capturedLookupWhere = [];
  mockState.selectCall = 0;
  mockState.executes = [];
  mockState.updates = [];
  mockState.inserts = [];

  // stand in for Postgres: the containment predicate admits exactly the row the
  // test queued up, or nothing.
  mockState.findFirst.mockImplementation(async () => mockState.rows[0] ?? null);

  const selectChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (...a: unknown[]) => { mockState.capturedWhere.push(a[0]); return chain; },
      limit: () => Promise.resolve(mockState.documentRows),
      then: (res: (v: unknown) => unknown) => Promise.resolve(mockState.documentRows).then(res),
    };
    mockState.selectCall++;
    return chain;
  };

  const txHandle = {
    query: {
      signingRequests: {
        findFirst: (opts: { where?: unknown }) => {
          mockState.capturedLookupWhere.push(opts?.where);
          return mockState.findFirst(opts);
        },
      },
    },
    select: selectChain,
    execute: vi.fn(async (statement: unknown) => {
      mockState.executes.push(statement);
      return undefined;
    }),
    update: vi.fn((table: unknown) => {
      mockState.updates.push(getTableName(table as Parameters<typeof getTableName>[0]));
      return { set: () => ({ where: () => Promise.resolve([]) }) };
    }),
    insert: vi.fn((table: unknown) => {
      mockState.inserts.push(getTableName(table as Parameters<typeof getTableName>[0]));
      return { values: () => Promise.resolve([]) };
    }),
  };

  mockState.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(txHandle));
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

  it('returns the live document name with the view (#2468: one read, no second gate)', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    const view = await getInternalSigningByToken(TOKEN);
    expect(view!.documentName).toBe('Proposal.pdf');
    expect(view!.documentId).toBe(DOC_ID);
    // the signer page used to issue a separate context-less `documents` read for
    // this name; the gate that already opened the row hands it back instead.
    expect(mockState.selectCall).toBe(1);
  });

  it('carries the credential into the lookup, and the row\'s tenant into the gate (#2468)', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    expect(await getInternalSigningByToken(TOKEN)).not.toBeNull();

    const text = mockState.executes.map((s) => inspect(s, { depth: 12 }));
    // 0123's arm reads app.portal_lookup_token, and it is set BEFORE the read
    expect(text[0]).toContain('app.portal_lookup_token');
    expect(text[0]).toContain(TOKEN);
    // …then the documents gate runs in the workspace that row named, so it can
    // actually see the document it is checking. Both transaction-local.
    expect(text[1]).toContain('app.current_tenant');
    expect(text[1]).toContain(TENANT_ID);
    expect(text[1]).toContain('true');
    expect(mockState.transaction).toHaveBeenCalledTimes(1);
  });

  it('keys the lookup on the credential in SQL, not on a JS scan of requests (#2468)', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { getInternalSigningByToken } = await import('@/lib/esignature');
    await getInternalSigningByToken(TOKEN);
    const text = inspect(mockState.capturedLookupWhere[0], { depth: 14 });
    expect(text).toContain('@>');
    expect(text).toContain('jsonb_build_object');
    expect(text).toContain(TOKEN);
    expect(text).toContain('internal');
  });
});

describe('POST /api/public/sign/[token] against a deleted document (#2380)', () => {
  it('reports not_found and never opens its transaction', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    mockState.documentRows = [];
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent(TOKEN, 'signed');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    // no signing_events row, no status rollup: only the credential lookup ran
    expect(mockState.transaction).toHaveBeenCalledTimes(1);
    expect(mockState.updates).toEqual([]);
    expect(mockState.inserts).toEqual([]);
  });

  it('still records the event for a live document', async () => {
    mockState.rows = [internalRow([{ token: TOKEN, name: 'A', email: 'a@b.com' }])];
    const { recordInternalSignerEvent } = await import('@/lib/esignature');
    const res = await recordInternalSignerEvent(TOKEN, 'signed');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('signed');
    // one transaction to resolve the credential, one to write inside its tenant
    expect(mockState.transaction).toHaveBeenCalledTimes(2);
    expect(mockState.updates).toEqual(['signing_requests']);
    expect(mockState.inserts).toEqual(['signing_events']);
    expect(mockState.executes.length).toBeGreaterThanOrEqual(2);
  });
});

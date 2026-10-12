/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2439 — `GET /api/public/invoices` identified the customer from `?email=`.
 *
 * Any caller could name an address and read that account's invoice totals: the
 * tenant was derived from whichever contact the emailed name happened to
 * resolve to, rather than from the caller. `#1133` / `#1913` fixed exactly this
 * on the quotes and ticket routes and never reached the invoice one, and the
 * portal page (`app/portal/(protected)/invoices/page.tsx`) was the only thing
 * passing the parameter — so the fix is to take the identity from the portal
 * credential like every other public route and 401 without one.
 *
 * The tests also pin the two facts that made the defect invisible: the old
 * blanket `catch` reported every failure as a well-formed empty list, and the
 * bare-pool reads this route used are the ones #2446 shows cannot match a row
 * under the RLS role the deployment enforces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const CONTACT_A = 'a0000000-0000-4000-8000-000000000001';

type Marker = { op: string; args: unknown[] };

const { captured, mockIdentity, mockContact } = vi.hoisted(() => ({
  captured: {
    bareSelects: 0,
    txSelects: 0,
    where: undefined as unknown,
    fieldMap: undefined as unknown,
    rlsArgs: undefined as unknown,
    contactArgs: undefined as unknown,
    transactions: 0,
  },
  mockIdentity: { current: null as unknown },
  mockContact: { current: null as unknown },
}));

const mk = (op: string) => (...args: unknown[]): Marker => ({ op, args });
const colName = (c: unknown) => (c as { name?: string })?.name;

const INVOICE_ROWS = [
  { id: 'inv-1', invoiceNumber: 'INV-1', status: 'sent', totalAmount: '100.00' },
];

function setup() {
  vi.resetModules();
  captured.bareSelects = 0;
  captured.txSelects = 0;
  captured.where = undefined;
  captured.fieldMap = undefined;
  captured.rlsArgs = undefined;
  captured.contactArgs = undefined;
  captured.transactions = 0;
  mockIdentity.current = null;
  mockContact.current = { id: CONTACT_A, tenantId: TENANT_A };

  // Keep the real drizzle-orm (the schema builds tables at import time) and
  // replace only the operators this route composes with, so the where-clause is
  // inspectable (pattern: tests/unit/public-kb-articles-tenant-scope.test.ts).
  vi.doMock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return {
      ...actual,
      eq: mk('eq'), and: mk('and'), desc: mk('desc'), isNull: mk('isNull'), inArray: mk('inArray'),
    };
  });

  vi.doMock('@/lib/portal-auth', () => ({
    resolvePortalIdentity: async () => mockIdentity.current,
    resolvePortalContact: async (identity: unknown, tx?: unknown) => {
      captured.contactArgs = [identity, tx];
      return mockContact.current;
    },
  }));

  // The context runner is the mechanism under test: it must hand the reads a
  // transaction that carries the tenant GUC, so `withTenantContext` is spied on
  // while NO_USER_SENTINEL stays the real constant.
  vi.doMock('@/lib/db/rls', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/db/rls')>();
    return {
      ...actual,
      withTenantContext: vi.fn(async (tenantId: string, userId: string, fn: (tx: unknown) => unknown) => {
        captured.rlsArgs = { tenantId, userId };
        captured.transactions += 1;
        const chain: Record<string, unknown> = {
          select: (fields: unknown) => {
            captured.txSelects += 1;
            captured.fieldMap = fields;
            return {
              from: () => ({
                where: (arg: unknown) => { captured.where = arg; return { orderBy: () => ({ limit: () => Promise.resolve(INVOICE_ROWS) }) }; },
              }),
            };
          },
        };
        return fn(chain);
      }),
    };
  });

  vi.doMock('@/drizzle/db', () => ({
    db: {
      select: () => {
        captured.bareSelects += 1;
        throw new Error('public/invoices must not read through the bare pool (#2446)');
      },
    },
  }));

  vi.doMock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(null) }));
  vi.doMock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
}

function callGet(query = '') {
  return import('@/app/api/public/invoices/route').then(async ({ GET }) => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(`http://localhost/api/public/invoices${query}`) as NextRequest;
    return GET(req);
  });
}

function whereArgs(): Marker[] {
  expect(captured.where).toBeDefined();
  const where = captured.where as Marker;
  expect(where.op).toBe('and');
  return where.args as Marker[];
}

function eqFilter(op: string, name: string): Marker | undefined {
  return whereArgs().find(f => f.op === op && colName(f.args[0]) === name);
}

beforeEach(setup);

describe('GET /api/public/invoices — identity comes from the credential (#2439)', () => {
  it('401s an anonymous caller instead of serving whatever email was asked for', async () => {
    mockIdentity.current = null;
    const res = await callGet('?email=victim@acme.com');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    expect(captured.transactions).toBe(0);
  });

  it('ignores ?email= — the contact is resolved from the authenticated identity', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    const res = await callGet('?email=victim@acme.com');
    expect(res.status).toBe(200);
    expect(captured.contactArgs[0]).toEqual({ email: 'me@mine.com', tenantId: TENANT_A });
  });

  it('pins the read to the tenant the credential names, with no user behind a portal call', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    await callGet();
    const { NO_USER_SENTINEL } = await import('@/lib/db/rls');
    expect(captured.rlsArgs).toEqual({ tenantId: TENANT_A, userId: NO_USER_SENTINEL });
    // ...and both reads run on the transaction that carries the GUC, never on
    // the bare pool (which is why this list is empty under the app role, #2446).
    expect(captured.contactArgs[1]).toBeDefined();
    expect(captured.bareSelects).toBe(0);
    expect(captured.txSelects).toBe(1);
  });

  it('scopes invoices to (tenant, contact) and keeps the soft-delete + sent-only filters', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    await callGet();
    expect(eqFilter('eq', 'tenant_id')?.args[1]).toBe(TENANT_A);
    expect(eqFilter('eq', 'contact_id')?.args[1]).toBe(CONTACT_A);
    expect(whereArgs().some(f => f.op === 'isNull')).toBe(true);
    const statuses = eqFilter('inArray', 'status')?.args[1] as string[];
    expect(statuses).toEqual(['sent', 'paid', 'overdue', 'partially_paid']);
    expect(statuses).not.toContain('draft');
    expect(statuses).not.toContain('cancelled');
  });

  it('returns only the fields a customer is owed — no internal notes or payment refs', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    const res = await callGet();
    const body = await res.json();
    expect(body.data).toEqual(INVOICE_ROWS);
    expect(Object.keys(captured.fieldMap as Record<string, unknown>).sort()).toEqual([
      'amountPaid', 'balanceDue', 'currency', 'dueDate', 'id', 'invoiceNumber',
      'issueDate', 'paidAt', 'status', 'totalAmount',
    ]);
  });

  it('still answers an empty list when the identity has no live contact', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    mockContact.current = null;
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    expect(captured.txSelects).toBe(0);
  });

  it('reports a failed read as an error instead of a well-formed empty list', async () => {
    mockIdentity.current = { email: 'me@mine.com', tenantId: TENANT_A };
    const { logError } = await import('@/lib/errors-server');
    vi.doMock('@/lib/db/rls', async () => ({
      NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
      withTenantContext: vi.fn().mockRejectedValue(new Error('row-level security policy for contacts')),
    }));
    const { GET } = await import('@/app/api/public/invoices/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://localhost/api/public/invoices') as NextRequest);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load invoices' });
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

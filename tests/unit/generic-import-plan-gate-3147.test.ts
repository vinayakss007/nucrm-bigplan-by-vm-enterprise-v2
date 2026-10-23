/**
 * #3147 — POST /api/tenant/import was the un-gated twin of the CSV importers:
 * contacts/leads rows went straight in with no plans.maxContacts check (quota
 * bypass) and tenants.currentContacts was never bumped (counter drift that
 * corrupts every later per-record check). The fix admits pool tables through
 * the FOR UPDATE gate + SQL-side increment; companies stay uncounted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  tenantRow: { currentContacts: 0, maxContacts: 10 } as Record<string, unknown> | null,
  poolInserts: [] as string[],
  plainInserts: [] as string[],
  counterSets: [] as Record<string, unknown>[],
  txUsed: 0,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      state.txUsed += 1;
      const tx = {
        select: () => {
          const chain: Record<string, unknown> = {
            from: () => chain,
            innerJoin: () => chain,
            where: () => chain,
          };
          chain.limit = () => chain;
          chain.for = () => Promise.resolve(state.tenantRow ? [state.tenantRow] : []);
          chain.then = (res: (v: unknown) => unknown) =>
            Promise.resolve(state.tenantRow ? [state.tenantRow] : []).then(res);
          return chain;
        },
        update: () => ({
          set: (vals: Record<string, unknown>) => {
            state.counterSets.push(vals);
            return { where: () => Promise.resolve([]) };
          },
        }),
        insert: (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
          values: (_rows: unknown) => {
            state.poolInserts.push(table[Symbol.for('drizzle:Name')] ?? '?');
            return Promise.resolve();
          },
        }),
      };
      return cb(tx);
    },
    insert: (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
      values: (_rows: unknown) => {
        state.plainInserts.push(table[Symbol.for('drizzle:Name')] ?? '?');
        return Promise.resolve();
      },
    }),
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: false }),
  // The route calls requirePerm WITHOUT await — keep the mock synchronous.
  requirePerm: () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => {
    throw err;
  },
}));

import { POST } from '@/app/api/tenant/import/route';

function postImport(body: unknown) {
  const req = new Request('http://localhost/api/tenant/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(req);
}

beforeEach(() => {
  state.tenantRow = { currentContacts: 0, maxContacts: 10 };
  state.poolInserts = [];
  state.plainInserts = [];
  state.counterSets = [];
  state.txUsed = 0;
});

describe('#3147 generic import enforces the contacts-pool plan gate', () => {
  it('403s when the import would exceed maxContacts and writes nothing', async () => {
    state.tenantRow = { currentContacts: 10, maxContacts: 10 };
    const res = await postImport({
      entity: 'contacts',
      records: [{ first_name: 'OneTooMany', email: 'a@b.co' }],
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('plan limit');
    expect(state.poolInserts).toHaveLength(0);
    expect(state.counterSets).toHaveLength(0);
  });

  it('admits rows that fit, bumps currentContacts SQL-side once per import', async () => {
    state.tenantRow = { currentContacts: 5, maxContacts: 10 };
    const res = await postImport({
      entity: 'contacts',
      records: [
        { first_name: 'Ann' },
        { email: 'no-name@example.com' }, // rejected: first_name required
        { first_name: 'Bo' },
        { first_name: 'Cy' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.imported).toBe(3);
    expect(body.data.errors).toEqual([{ row: 2, error: 'first_name is required' }]);
    expect(state.txUsed).toBe(1);
    expect(state.counterSets).toHaveLength(1);
    expect(state.counterSets[0]).toHaveProperty('currentContacts');
  });

  it('leads share the same pool gate', async () => {
    state.tenantRow = { currentContacts: 9, maxContacts: 10 };
    const res = await postImport({
      entity: 'leads',
      records: [{ first_name: 'A' }, { first_name: 'B' }],
    });
    expect(res.status).toBe(403);
    expect(state.poolInserts).toHaveLength(0);
  });

  it('companies are not pool-counted and bypass the gate entirely', async () => {
    const res = await postImport({
      entity: 'companies',
      records: [{ name: 'Acme' }, { name: 'Globex' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.imported).toBe(2);
    expect(state.txUsed).toBe(0);
    expect(state.plainInserts).toContain('companies');
  });
});

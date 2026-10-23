/**
 * #3134 — handleSigningWebhook applied provider statuses unconditionally, so
 * an out-of-order or duplicate webhook could overwrite a terminal status
 * (signed → viewed), and expired/voided envelopes were coerced to 'viewed' by
 * the route mappers. Status writes must be monotonic, locked in the
 * transaction, and duplicates must no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  preRead: null as { id: string; tenantId: string; status: string } | null,
  lockedStatus: undefined as string | undefined,
  forUpdateCalls: 0,
  updatedTo: undefined as string | undefined,
  eventRows: [] as Record<string, unknown>[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      signingRequests: {
        findFirst: async () => state.preRead,
      },
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        select: () => {
          const chain: Record<string, unknown> = {
            from: () => chain,
            where: () => chain,
            limit: () => chain,
            for: () => {
              state.forUpdateCalls += 1;
              return Promise.resolve(state.lockedStatus === undefined ? [] : [{ status: state.lockedStatus }]);
            },
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve(state.lockedStatus === undefined ? [] : [{ status: state.lockedStatus }]).then(res),
          };
          return chain;
        },
        update: () => ({
          set: (vals: { status?: string }) => {
            state.updatedTo = vals.status;
            return { where: () => Promise.resolve([]) };
          },
        }),
        insert: () => ({
          values: (row: Record<string, unknown>) => {
            state.eventRows.push(row);
            return Promise.resolve();
          },
        }),
      }),
  },
}));
vi.mock('@/drizzle/schema/esignature', () => ({
  signingRequests: { id: 'sr.id', tenantId: 'sr.tenant_id', status: 'sr.status', externalId: 'sr.external_id', provider: 'sr.provider' },
  signingEvents: { requestId: 'se.request_id' },
}));

import { handleSigningWebhook } from '@/lib/esignature';

beforeEach(() => {
  state.preRead = { id: 'req-1', tenantId: 'tenant-1', status: 'sent' };
  state.lockedStatus = 'sent';
  state.forUpdateCalls = 0;
  state.updatedTo = undefined;
  state.eventRows = [];
});

const payload = {
  provider: 'docusign' as const,
  externalId: 'ext-1',
  event: 'signed' as const,
};

describe('#3134 signing webhook status writes are monotonic', () => {
  it('locks the request row FOR UPDATE inside the transaction', async () => {
    await handleSigningWebhook(payload);
    expect(state.forUpdateCalls).toBe(1);
  });

  it('advances sent → signed and reports updated:true', async () => {
    const res = await handleSigningWebhook(payload);
    expect(res.updated).toBe(true);
    expect(state.updatedTo).toBe('signed');
    expect(state.eventRows).toHaveLength(1);
  });

  it('a late viewed webhook does not un-sign an already signed request', async () => {
    state.lockedStatus = 'signed';
    const res = await handleSigningWebhook({ ...payload, event: 'viewed' });
    expect(res.updated).toBe(false);
    expect(state.updatedTo).toBeUndefined();
    // the event is still recorded for audit
    expect(state.eventRows).toHaveLength(1);
  });

  it('a duplicate signed delivery is a no-op but still logged', async () => {
    state.lockedStatus = 'signed';
    const res = await handleSigningWebhook(payload);
    expect(res.updated).toBe(false);
    expect(state.updatedTo).toBeUndefined();
    expect(state.eventRows).toHaveLength(1);
  });

  it('expired is terminal: a late viewed cannot resurrect an expired request', async () => {
    state.lockedStatus = 'expired';
    const res = await handleSigningWebhook({ ...payload, event: 'viewed' });
    expect(res.updated).toBe(false);
  });

  it('sent → expired applies (the #3134 unmapped-event fix)', async () => {
    const res = await handleSigningWebhook({ ...payload, event: 'expired' });
    expect(res.updated).toBe(true);
    expect(state.updatedTo).toBe('expired');
  });
});

describe('#3134 route mappers stop coercing expiry to viewed', () => {
  it('maps provider expiry/void events to expired', async () => {
    const fs = await import('fs');
    const code = fs.readFileSync('app/api/tenant/esignature/webhook/route.ts', 'utf-8');
    expect(code).toMatch(/'envelope-expired':\s*'expired'/);
    expect(code).toMatch(/'envelope-voided':\s*'expired'/);
    expect(code).toMatch(/'signature_request_expired':\s*'expired'/);
  });
});

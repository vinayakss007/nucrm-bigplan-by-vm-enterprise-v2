/**
 * Route-level test for POST /api/tenant/leads — issue #2343 retry wiring.
 *
 * The unique idx_leads_tenant_oid (migration 0114) makes a residual
 * concurrent-allocation race a loud 23505. The POST must RETRY the whole
 * create transaction in exactly that case — not surface a 500, and not
 * retry unrelated unique violations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const state = { txFailsWithOid23505: false, txFailsWithOther23505: false, txCalls: 0 };

  const leadRow = {
    id: 'lead-new',
    tenantId: 'a1111111-1111-4111-8111-111111111111',
    email: '',
    assignedTo: 'member-1',
    tags: [],
    leadOid: 'LD-2026-005',
  };

  const makeTx = () => {
    const throwIfConfigured = () => {
      if (state.txFailsWithOid23505) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "idx_leads_tenant_oid"'),
          { code: '23505', constraint: 'idx_leads_tenant_oid' },
        );
      }
      if (state.txFailsWithOther23505) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "uq_contacts_email"'),
          { code: '23505', constraint: 'uq_contacts_email' },
        );
      }
    };
    const chain: Record<string, unknown> = {};
    chain.values = () => ({
      returning: async () => {
        // only the LEADS insert carries .returning() in the route; the
        // activity inserts resolve plain awaits, so the collision fires here.
        if (chain.__table === m.leadsSentinel) throwIfConfigured();
        return [{ ...m.leadRow }];
      },
    });
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => {
        const c: Record<string, unknown> = {};
        c.from = () => c; c.where = () => c; c.limit = () => Promise.resolve([]);
        return c;
      }),
      insert: vi.fn((table: unknown) => {
        chain.__table = table;
        return chain;
      }),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    return { tx };
  };

  const leadsSentinel = { __table: 'leads' };

  const db = {
    transaction: vi.fn(async (cb: (tx: ReturnType<typeof makeTx>['tx']) => Promise<unknown>) => {
      state.txCalls += 1;
      return cb(makeTx().tx);
    }),
    select: vi.fn(() => {
      const c: Record<string, unknown> = {};
      c.from = () => c; c.where = () => c; c.limit = () => Promise.resolve([]);
      return c;
    }),
  };

  return { state, db, leadsSentinel, leadRow };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  leads: m.leadsSentinel,
  users: { id: 'users.id' },
  companies: { id: 'companies.id' },
  contacts: { id: 'contacts.id' },
  leadActivities: { __table: 'lead_activities' },
  activities: { __table: 'activities' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})), and: vi.fn(() => ({})), or: vi.fn(() => ({})),
  desc: vi.fn(() => ({})), ilike: vi.fn(() => ({})), isNull: vi.fn(() => ({})),
  gte: vi.fn(() => ({})), lte: vi.fn(() => ({})), arrayContains: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: 'a1111111-1111-4111-8111-111111111111', userId: 'member-1' })),
  requirePerm: vi.fn(() => undefined),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H>(h: H): H => h }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
  validateQuery: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/assignment-resolver', () => ({
  resolveAssignee: vi.fn(async () => null),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/leads/oid', async () => {
  const actual = await vi.importActual<typeof import('@/lib/leads/oid')>('@/lib/leads/oid');
  return {
    isLeadOidCollision: actual.isLeadOidCollision,
    generateLeadOid: vi.fn(async () => 'LD-2026-005'),
  };
});

import { POST } from '@/app/api/tenant/leads/route';

function leadRequest() {
  return new Request('http://localhost:3000/api/tenant/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ first_name: 'Ada', last_name: 'L', contact_id: 'contact-1' }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.txCalls = 0;
  m.state.txFailsWithOid23505 = false;
  m.state.txFailsWithOther23505 = false;
});

describe('POST /api/tenant/leads — lead_oid collision retry (#2343)', () => {
  it('succeeds on the first attempt when there is no collision', async () => {
    const res = await POST(leadRequest());
    expect(res.status).toBe(201);
    expect(m.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('retries the whole tx on idx_leads_tenant_oid 23505 and lands the lead', async () => {
    // fail ONLY the first attempt; the default makeTx (flags off) succeeds
    m.db.transaction.mockImplementationOnce(async (cb) => {
      m.state.txCalls += 1;
      const failing = {
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => {
          const c: Record<string, unknown> = {};
          c.from = () => c; c.where = () => c; c.limit = () => Promise.resolve([]);
          return c;
        }),
        insert: vi.fn(() => ({
          values: () => ({
            returning: async () => {
              throw Object.assign(
                new Error('duplicate key value violates unique constraint "idx_leads_tenant_oid"'),
                { code: '23505', constraint: 'idx_leads_tenant_oid' },
              );
            },
          }),
        })),
        update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
      };
      return cb(failing as never);
    });

    const res = await POST(leadRequest());
    expect(res.status).toBe(201);
    expect(m.db.transaction).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a different unique constraint — surfaces 500 after one attempt', async () => {
    m.state.txFailsWithOther23505 = true;
    const res = await POST(leadRequest());
    expect(res.status).toBe(500);
    expect(m.db.transaction).toHaveBeenCalledTimes(1);
  });
});

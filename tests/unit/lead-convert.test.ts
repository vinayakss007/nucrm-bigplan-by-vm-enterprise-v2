import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1454 regression: convertLeadCore must actually create a deal when
 * createDeal:true is passed (the camelCase key the interface + callers use).
 * The bug was that the function destructured snake_case keys that never
 * matched, so create_deal was always undefined and the deal branch never ran.
 */

// ── Schema table markers (identity objects so we can tell inserts apart) ──────
const T = {
  leads: { __t: 'leads' },
  contacts: { __t: 'contacts' },
  companies: { __t: 'companies' },
  deals: { __t: 'deals' },
  pipelines: { __t: 'pipelines' },
  leadActivities: { __t: 'leadActivities' },
  activities: { __t: 'activities' },
  dealStages: { __t: 'dealStages' },
  tenants: { __t: 'tenants' },
};

vi.mock('@/drizzle/schema', () => T);

// A lead that already has a linked contact (new-workflow path — no contact insert).
const LEAD = {
  id: 'lead-1',
  tenantId: 'tenant-1',
  contactId: 'contact-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  companyId: 'company-1',
  companyName: 'Analytical Engines',
  leadStatus: 'qualified',
  assignedTo: 'user-9',
  value: 5000,
  score: 42,
  tags: [],
};

// Records every table an insert() targeted, so the test can assert a deal
// was (or was not) created.
const insertedTables: string[] = [];

function makeInsertChain(table: { __t: string }) {
  return {
    values: () => ({
      returning: async () => {
        insertedTables.push(table.__t);
        // deals/companies/contacts inserts read back an id
        return [{ id: `${table.__t}-new` }];
      },
      // leadActivities/activities inserts are fire-and-forget (.catch)
      catch: () => Promise.resolve(),
      then: (res: (v: unknown) => unknown) => { insertedTables.push(table.__t); return Promise.resolve(res(undefined)); },
    }),
  };
}

function makeUpdateChain() {
  return { set: () => ({ where: async () => ({ rowCount: 1 }) }) };
}

const tx = {
  query: {
    companies: { findFirst: async () => ({ id: 'company-1' }) },
    contacts: { findFirst: async () => ({ id: 'contact-1', score: 0 }) },
    pipelines: { findFirst: async () => ({ id: 'pipeline-1' }) },
    dealStages: { findFirst: async () => ({ id: 'stage-1' }) },
  },
  insert: (table: { __t: string }) => makeInsertChain(table),
  update: () => makeUpdateChain(),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: { leads: { findFirst: async () => LEAD } },
    transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    update: () => makeUpdateChain(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: () => ({}), and: () => ({}), isNull: () => ({}),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

describe('convertLeadCore (#1454)', () => {
  beforeEach(() => {
    insertedTables.length = 0;
  });

  it('creates a deal when createDeal is true', async () => {
    const { convertLeadCore } = await import('@/lib/leads/convert');
    const result = await convertLeadCore({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      leadId: 'lead-1',
      createDeal: true,
      dealTitle: 'Big Deal',
      dealValue: 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dealId).toBe('deals-new'); // a deal was inserted
    }
    expect(insertedTables).toContain('deals');
  });

  it('does NOT create a deal when createDeal is false/omitted', async () => {
    const { convertLeadCore } = await import('@/lib/leads/convert');
    const result = await convertLeadCore({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      leadId: 'lead-1',
      // createDeal omitted → defaults to false
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dealId).toBeNull();
    }
    expect(insertedTables).not.toContain('deals');
  });
});

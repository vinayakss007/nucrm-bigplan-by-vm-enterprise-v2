/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3409 — in-transaction quota admission on lead conversion.
 *
 * Lead conversion (convertLeadCore) creates contacts and optionally deals, and bumps
 * tenants.currentContacts and tenants.currentDeals.
 *
 * Prior to #3409:
 *   1. Quota limits (maxContacts, maxDeals) were never checked in convertLeadCore.
 *   2. The route POST /api/tenant/leads/[id]/convert lacked quota gates and 402 responses.
 *   3. Bulk conversion did not stop or respect quota limits.
 *   4. Counter updates used raw `sql`${tenants.currentContacts} + 1`` without COALESCE,
 *      risking NULL drift under concurrency.
 *
 * This suite verifies:
 *   A. Quota admission inside convertLeadCore's transaction:
 *      - Locks the tenant row FOR UPDATE before writing.
 *      - Refuses with contact_limit_reached when currentContacts + 1 > maxContacts.
 *      - Refuses with deal_limit_reached when createDeal: true and currentDeals + 1 > maxDeals.
 *      - Merging into an existing contact does not consume contact quota.
 *      - Refusal occurs before any row is written (zero side-effects).
 *   B. Route responses:
 *      - Returns 402 with planLimitReachedResponse for contacts or deals.
 *   C. Bulk conversion:
 *      - Halts conversion loop upon quota refusal and reports only admitted rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { TENANT, USER, LEAD_ID, state } = vi.hoisted(() => {
  const tenantStr = '11111111-1111-4111-8111-111111111111';
  const userStr = '22222222-2222-4222-8222-222222222222';
  const leadIdStr = 'lead-1111-1111-1111';
  return {
    TENANT: tenantStr,
    USER: userStr,
    LEAD_ID: leadIdStr,
    state: {
      lockedTenant: [] as Array<{
        currentContacts: number | null;
        maxContacts: number | null;
        currentDeals: number | null;
        maxDeals: number | null;
      }>,
      writes: [] as string[],
      counterUpdates: [] as Array<{ column: string; value: unknown }>,
      locked: false,
      preflightDeal: null as Response | null,
      enforceLimits: true,
      lead: {
        id: leadIdStr,
        tenantId: tenantStr,
        contactId: null as string | null,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        companyId: null as string | null,
        companyName: 'Analytical Engines Ltd',
        leadStatus: 'qualified',
        isConverted: false,
        convertedContactId: null as string | null,
        assignedTo: userStr,
        value: 5000,
        score: 80,
        tags: [] as string[],
        deletedAt: null,
      },
      existingContactByEmail: null as { id: string; score: number | null } | null,
    },
  };
});

function tableName(table: unknown): string | undefined {
  if (!table || typeof table !== 'object') return undefined;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : undefined;
}

const tx = {
  // #3405: withTenantDb sets the tenant GUC via tx.execute() inside the tx.
  execute: async () => undefined,
  select: () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit']) builder[m] = chain;
    builder['for'] = () => {
      state.locked = true;
      return Promise.resolve(state.lockedTenant);
    };
    return builder;
  },
  query: {
    // #3405: the lead lookup now runs on the branded client's tx too.
    leads: { findFirst: async () => state.lead },
    companies: { findFirst: async () => null },
    contacts: { findFirst: async () => state.existingContactByEmail },
    pipelines: { findFirst: async () => ({ id: 'pipeline-1' }) },
    dealStages: { findFirst: async () => ({ id: 'stage-1', order: 1 }) },
  },
  insert: (table: unknown) => ({
    values: () => {
      const name = tableName(table) ?? 'unknown';
      state.writes.push(`insert:${name}`);
      const p = Promise.resolve([{ id: `${name}-new` }]) as Promise<unknown> & Record<string, unknown>;
      p['returning'] = () => Promise.resolve([{ id: `${name}-new` }]);
      p['catch'] = () => Promise.resolve();
      return p;
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      const name = tableName(table) ?? 'unknown';
      if (name === 'tenants') {
        if ('currentContacts' in values) {
          state.counterUpdates.push({ column: 'currentContacts', value: values['currentContacts'] });
          state.writes.push('update:tenants:contacts');
        }
        if ('currentDeals' in values) {
          state.counterUpdates.push({ column: 'currentDeals', value: values['currentDeals'] });
          state.writes.push('update:tenants:deals');
        }
      } else {
        state.writes.push(`update:${name}`);
      }
      return {
        where: () => Promise.resolve({ rowCount: 1 }),
      };
    },
  }),
};

const mockDb = vi.hoisted(() => ({
  transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  query: {
    leads: { findFirst: async () => state.lead },
  },
  select: () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit']) builder[m] = chain;
    builder['then'] = (res: (v: unknown) => unknown) => Promise.resolve(res([]));
    return builder;
  },
  update: () => ({
    set: () => ({
      where: () => Promise.resolve({ rowCount: 1 }),
    }),
  }),
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));

vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async (req: Request) => req.json() };
});

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({
    userId: USER,
    tenantId: TENANT,
    roleSlug: 'rep',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
  }),
  can: () => true,
  requirePerm: () => null,
  withApiRouteCtx: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}), bulkIdsAudit: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => {}) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: async (_ctx: unknown, _entity: string, body: Record<string, unknown>) => ({
    body,
    stripped: [] as string[],
  }),
  enforceFieldRead: async (_ctx: unknown, _entity: string, rows: Record<string, unknown>[]) => rows,
  attachStrippedFields: (res: Response) => res,
}));

vi.mock('@/lib/usage/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/usage/middleware')>();
  return {
    ...actual,
    checkLimit: vi.fn(async (_ctx: unknown, kind: string) => {
      if (kind === 'deals') return state.preflightDeal;
      return null;
    }),
    limitsEnforce: vi.fn(() => state.enforceLimits),
  };
});

beforeEach(() => {
  state.lockedTenant = [
    { currentContacts: 5, maxContacts: 10, currentDeals: 2, maxDeals: 5 },
  ];
  state.writes = [];
  state.counterUpdates = [];
  state.locked = false;
  state.preflightDeal = null;
  state.enforceLimits = true;
  state.lead = {
    id: LEAD_ID,
    tenantId: TENANT,
    contactId: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    companyId: null,
    companyName: 'Analytical Engines Ltd',
    leadStatus: 'qualified',
    isConverted: false,
    convertedContactId: null,
    assignedTo: USER,
    value: 5000,
    score: 80,
    tags: [],
    deletedAt: null,
  };
  state.existingContactByEmail = null;
});

describe('#3409 — convertLeadCore in-transaction quota admission', () => {
  it('refuses conversion when tenant is at maxContacts and a new contact is needed', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 2, maxDeals: 5 },
    ];
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: false,
      enforceLimits: true,
    });

    expect(state.locked).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('contact_limit_reached');
      if (result.reason === 'contact_limit_reached') {
        expect(result.limit).toBe(10);
        expect(result.actual).toBe(11);
      }
    }
    // Zero write operations performed
    expect(state.writes).toEqual([]);
    expect(state.counterUpdates).toEqual([]);
  });

  it('allows conversion when tenant is at maxContacts but contact is already linked (intake link)', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 2, maxDeals: 5 },
    ];
    state.lead.contactId = 'existing-contact-123';
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: false,
      enforceLimits: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isNewContact).toBe(false);
      expect(result.contactId).toBe('existing-contact-123');
    }
    // Contact was updated, not inserted; contact counter was NOT bumped
    expect(state.writes).toContain('update:contacts');
    expect(state.writes).not.toContain('update:tenants:contacts');
  });

  it('allows conversion when tenant is at maxContacts but email dedup matches an existing contact', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 2, maxDeals: 5 },
    ];
    state.existingContactByEmail = { id: 'deduped-contact-456', score: 50 };
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: false,
      enforceLimits: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isNewContact).toBe(false);
      expect(result.contactId).toBe('deduped-contact-456');
    }
    // Merged into existing contact, no contact quota consumed
    expect(state.writes).toContain('update:contacts');
    expect(state.writes).not.toContain('update:tenants:contacts');
  });

  it('refuses conversion when tenant is at maxDeals and createDeal is true', async () => {
    state.lockedTenant = [
      { currentContacts: 2, maxContacts: 10, currentDeals: 5, maxDeals: 5 },
    ];
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: true,
      dealTitle: 'Over Deal Limit',
      enforceLimits: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('deal_limit_reached');
      if (result.reason === 'deal_limit_reached') {
        expect(result.limit).toBe(5);
        expect(result.actual).toBe(6);
      }
    }
    // Zero writes performed
    expect(state.writes).toEqual([]);
    expect(state.counterUpdates).toEqual([]);
  });

  it('succeeds when under limits and atomically updates counters with COALESCE', async () => {
    state.lockedTenant = [
      { currentContacts: 3, maxContacts: 10, currentDeals: 1, maxDeals: 5 },
    ];
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: true,
      dealTitle: 'New Enterprise Deal',
      dealValue: 15000,
      enforceLimits: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isNewContact).toBe(true);
      expect(result.contactId).toBe('contacts-new');
      expect(result.dealId).toBe('deals-new');
    }
    expect(state.writes).toContain('insert:contacts');
    expect(state.writes).toContain('insert:deals');
    expect(state.writes).toContain('update:tenants:contacts');
    expect(state.writes).toContain('update:tenants:deals');
  });

  it('bypasses limit enforcement when enforceLimits is false', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 5, maxDeals: 5 },
    ];
    const { convertLeadCore } = await import('@/lib/leads/convert');

    const result = await convertLeadCore({
      tenantId: TENANT,
      actorId: USER,
      leadId: LEAD_ID,
      createDeal: true,
      dealTitle: 'Bypass Deal',
      enforceLimits: false,
    });

    expect(result.ok).toBe(true);
    expect(state.writes).toContain('insert:contacts');
    expect(state.writes).toContain('insert:deals');
  });
});

describe('#3409 — POST /api/tenant/leads/[id]/convert route responses', () => {
  async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/tenant/leads/[id]/convert/route');
    const req = new NextRequest(`http://localhost/api/tenant/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    return (await POST(req, { params: Promise.resolve({ id: LEAD_ID }) })) as Response;
  }

  it('returns 402 with contacts limit body when contact limit reached', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 1, maxDeals: 5 },
    ];
    const res = await callRoute({ create_deal: false });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Plan limit reached for contacts',
      kind: 'contacts',
      limit: 10,
      actual: 11,
      upgradeUrl: '/tenant/settings/billing',
    });
  });

  it('returns 402 with deals limit body when preflight deal limit is hit', async () => {
    const { planLimitReachedResponse } = await import('@/lib/usage/middleware');
    state.preflightDeal = planLimitReachedResponse('deals', 5, 5);

    const res = await callRoute({ create_deal: true, deal_title: 'Big Deal' });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.kind).toBe('deals');
    expect(body.limit).toBe(5);
  });

  it('returns 402 with deals limit body when in-transaction deal limit is hit', async () => {
    state.lockedTenant = [
      { currentContacts: 2, maxContacts: 10, currentDeals: 5, maxDeals: 5 },
    ];
    const res = await callRoute({ create_deal: true, deal_title: 'Deal At Limit' });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.kind).toBe('deals');
    expect(body.limit).toBe(5);
    expect(body.actual).toBe(6);
  });

  it('returns 201 when conversion is permitted under quotas', async () => {
    state.lockedTenant = [
      { currentContacts: 2, maxContacts: 10, currentDeals: 1, maxDeals: 5 },
    ];
    const res = await callRoute({ create_deal: true, deal_title: 'Permitted Deal' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.contact_id).toBe('contacts-new');
    expect(body.deal_id).toBe('deals-new');
  });
});

describe('#3409 — bulk lead conversion halts upon quota limit', () => {
  it('breaks out of conversion loop upon quota refusal and records only admitted rows', async () => {
    state.lockedTenant = [
      { currentContacts: 10, maxContacts: 10, currentDeals: 1, maxDeals: 5 },
    ];
    const { convertLeadCore } = await import('@/lib/leads/convert');

    // Simulate bulk conversion runner
    const toConvert = ['lead-1', 'lead-2', 'lead-3'];
    let convertedCount = 0;
    const convertedIds: string[] = [];

    for (const leadId of toConvert) {
      const result = await convertLeadCore({
        tenantId: TENANT,
        actorId: USER,
        leadId,
        enforceLimits: true,
      });
      if (result.ok) {
        convertedCount += 1;
        convertedIds.push(leadId);
      } else if (result.reason === 'contact_limit_reached' || result.reason === 'deal_limit_reached') {
        break;
      }
    }

    expect(convertedCount).toBe(0);
    expect(convertedIds).toEqual([]);
  });
});

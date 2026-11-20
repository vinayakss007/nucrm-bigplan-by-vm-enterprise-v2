/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A3 producer — `checkNeedsApproval`/`requestApproval` had zero callers,
 * so the approval inbox could only ever be empty. These tests pin the
 * rule-matched staging of a deal PATCH and the narrow replay on FINAL approval.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';
const RULE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const BASE = '2026-01-01T00:00:00.000Z';

const h = vi.hoisted(() => ({
  ruleRows: [] as Record<string, unknown>[],
  pendingRows: [] as unknown[][],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  insertReturns: [] as unknown[][],
  updates: [] as { table: string; set: Record<string, unknown>; where: { sql: string; params: unknown[] } }[],
  updateReturns: [] as unknown[][],
}));

vi.mock('@/drizzle/db', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const { getTableName } = await import('drizzle-orm');
  const dialect = new PgDialect({} as never);
  const render = (p: unknown) => {
    const q = dialect.sqlToQuery(p as never);
    return { sql: q.sql, params: q.params as unknown[] };
  };
  const db: Record<string, unknown> = {
    select: () => {
      const b: Record<string, unknown> = {};
      let where = { sql: '', params: [] as unknown[] };
      b.from = () => b;
      b.where = (p: unknown) => { where = render(p); return b; };
      b.limit = () => Promise.resolve(
        where.sql.includes('approval_rules') ? h.ruleRows
          : where.sql.includes('approval_requests') ? h.pendingRows.shift() ?? []
            : [],
      );
      return b;
    },
    insert: (table: unknown) => {
      const b: Record<string, unknown> = {};
      b.values = (v: Record<string, unknown>) => {
        h.inserts.push({ table: getTableName(table as never), values: v });
        return b;
      };
      b.onConflictDoNothing = () => b;
      b.returning = () => Promise.resolve(h.insertReturns.shift()
        ?? [{ id: RULE + '-request', currentStep: 1, ...h.inserts.at(-1)!.values }]);
      return b;
    },
    update: (table: unknown) => {
      const b: Record<string, unknown> = {};
      let set: Record<string, unknown> = {};
      b.set = (v: Record<string, unknown>) => { set = v; return b; };
      b.where = (p: unknown) => {
        h.updates.push({ table: getTableName(table as never), set, where: render(p) });
        return b;
      };
      b.returning = () => Promise.resolve(h.updateReturns.shift() ?? [{ id: DEAL }]);
      return b;
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import {
  stageDealChange, stageContactChange, stageLeadChange, stageCompanyChange, stageTaskChange,
  stageDealCreateResponse, stageContactCreateResponse, stageLeadCreateResponse,
  stageCompanyCreateResponse, stageTaskCreateResponse,
  applyApprovedChange,
} from '@/lib/rbac/approval-producer';

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: {},
  isAdmin: false, isSuperAdmin: false, ...over,
} as AuthContext);

const rule = {
  id: RULE, tenantId: TENANT, entityType: 'deal', conditionField: 'amount',
  conditionOperator: '>=', conditionValue: '10000', approverRoleSlug: 'manager',
  autoApproveRoles: ['vp'],
};

beforeEach(() => {
  h.ruleRows = []; h.pendingRows = []; h.inserts = []; h.insertReturns = [];
  h.updates = []; h.updateReturns = [];
});

describe('stageDealChange (#2597 A3)', () => {
  it('does nothing for an admin, without even loading rules', async () => {
    expect(await stageDealChange(ctx({ isAdmin: true }), DEAL, { amount: 20000 }, { amount: 20000 }, BASE))
      .toEqual({ kind: 'none' });
    expect(h.inserts).toHaveLength(0);
  });

  it('does nothing when no rule matches the proposed amount', async () => {
    h.ruleRows = [rule]; h.pendingRows = [[]];
    expect(await stageDealChange(ctx(), DEAL, { amount: 100 }, { amount: 100 }, BASE))
      .toEqual({ kind: 'none' });
    expect(h.inserts).toHaveLength(0);
  });

  it('rejects a stage transition instead of staging it silently', async () => {
    expect(await stageDealChange(ctx(), DEAL, {}, { stage_id: 'x' }, BASE))
      .toEqual({ kind: 'unsupported', reason: 'stage_id changes cannot go through approval yet' });
  });

  it('stages a rule-matched PATCH with the chain and the base timestamp', async () => {
    h.ruleRows = [rule]; h.pendingRows = [[]];
    const result = await stageDealChange(ctx(), DEAL, { amount: 20000 }, { amount: 20000 }, BASE);
    expect(result.kind).toBe('staged');
    const request = h.inserts.find((i) => i.table === 'approval_requests')!;
    expect(request.values).toMatchObject({
      tenantId: TENANT, entityType: 'deals', entityId: DEAL, ruleId: RULE,
      status: 'pending', currentStep: 1,
      steps: [
        { order: 1, approverRole: 'manager', status: 'pending' },
        { order: 2, approverRole: 'vp', status: 'pending' },
      ],
    });
    expect(request.values.pendingData).toEqual({ body: { amount: 20000 }, baseUpdatedAt: BASE });
  });

  it('refuses a second pending request for the same deal', async () => {
    h.ruleRows = [rule]; h.pendingRows = [[{ id: 'existing' }]];
    expect(await stageDealChange(ctx(), DEAL, { amount: 20000 }, { amount: 20000 }, BASE))
      .toEqual({ kind: 'conflict', requestId: 'existing' });
    expect(h.inserts).toHaveLength(0);
  });
});

describe('stageContactChange (#2597 A3, contacts rollout)', () => {
  const contactRule = {
    ...rule, id: RULE + '-c', entityType: 'contact', conditionField: 'lead_status',
    conditionOperator: '==', conditionValue: 'qualified',
  };

  it('stages a rule-matched contact PATCH under the contacts entity name', async () => {
    h.ruleRows = [contactRule]; h.pendingRows = [[]];
    const result = await stageContactChange(
      ctx(), DEAL, { lead_status: 'qualified' }, { lead_status: 'qualified', first_name: 'A' }, BASE,
    );
    expect(result.kind).toBe('staged');
    const request = h.inserts.find((i) => i.table === 'approval_requests')!;
    expect(request.values).toMatchObject({ entityType: 'contacts', entityId: DEAL });
    expect(request.values.pendingData).toEqual({
      body: { lead_status: 'qualified', first_name: 'A' }, baseUpdatedAt: BASE,
    });
  });

  it('does nothing when the contact rule does not match', async () => {
    h.ruleRows = [contactRule]; h.pendingRows = [[]];
    expect(await stageContactChange(ctx(), DEAL, { lead_status: 'new' }, { lead_status: 'new' }, BASE))
      .toEqual({ kind: 'none' });
  });
});

describe.each([
  ['leads', stageLeadChange, { lead_status: 'qualified' }],
  ['companies', stageCompanyChange, { name: 'New name' }],
  ['tasks', stageTaskChange, { status: 'completed' }],
] as const)('stage%s (%s)', (entity, stage, body) => {
  it(`stages a rule-matched ${entity} PATCH under the ${entity} entity name`, async () => {
    const entityRule = {
      ...rule, id: RULE + '-' + entity, entityType: entity,
      conditionField: Object.keys(body)[0]!, conditionOperator: '==',
      conditionValue: Object.values(body)[0] as string,
    };
    h.ruleRows = [entityRule]; h.pendingRows = [[]];
    const result = await stage(ctx(), DEAL, body, body, BASE);
    expect(result.kind).toBe('staged');
    const request = h.inserts.find((i) => i.table === 'approval_requests')!;
    expect(request.values).toMatchObject({ entityType: entity, entityId: DEAL });
  });
});

describe('applyApprovedChange (#2597 A3)', () => {
  const base = {
    id: 'req-1', tenantId: TENANT, entityType: 'deals', entityId: DEAL, status: 'approved',
    pendingData: { body: { title: 'Approved', amount: 20000 }, baseUpdatedAt: BASE },
  };

  it('does not replay an intermediate chain step or a rejection', async () => {
    expect(await applyApprovedChange({ ...base, status: 'pending' }, USER))
      .toEqual({ applied: false, reason: 'not_final' });
    expect(h.updates).toHaveLength(0);
  });

  it('skips legacy decision-only requests', async () => {
    expect(await applyApprovedChange({ ...base, pendingData: null }, USER))
      .toEqual({ applied: false, reason: 'no_staged_change' });
  });

  it('applies only allowlisted fields, tenant-scoped and compare-and-swap', async () => {
    expect(await applyApprovedChange(base, USER)).toEqual({ applied: true });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.table).toBe('deals');
    expect(h.updates[0]!.set).toMatchObject({ title: 'Approved', amount: '20000' });
    expect(h.updates[0]!.set).not.toHaveProperty('deletedAt');
    expect(h.updates[0]!.where.sql).toContain('tenant_id');
    expect(h.updates[0]!.where.sql).toContain('deleted_at');
    expect(h.updates[0]!.where.sql).toContain('date_trunc');
    expect(h.updates[0]!.where.params).toContain(TENANT);
    expect(h.updates[0]!.where.params).toContain(DEAL);
    expect(h.inserts.map((i) => i.table)).toContain('activities');
  });

  it('replays a staged contact change onto the contacts table', async () => {
    const result = await applyApprovedChange({
      ...base, entityType: 'contacts',
      pendingData: { body: { lead_status: 'qualified', first_name: 'A' }, baseUpdatedAt: BASE },
    }, USER);
    expect(result).toEqual({ applied: true });
    expect(h.updates[0]!.table).toBe('contacts');
    expect(h.updates[0]!.set).toMatchObject({ leadStatus: 'qualified', firstName: 'A' });
    expect(h.updates[0]!.where.sql).toContain('tenant_id');
  });

  it.each([
    ['leads', { lead_status: 'qualified' }, { leadStatus: 'qualified' }],
    ['companies', { annual_revenue: 50000 }, { annualRevenue: '50000' }],
    ['tasks', { due_date: '2026-02-01T00:00:00.000Z' }, { dueDate: new Date('2026-02-01T00:00:00.000Z') }],
  ])('replays a staged %s change onto its own table', (entity, body, expected) => {
    return applyApprovedChange({
      ...base, entityType: entity, pendingData: { body, baseUpdatedAt: BASE },
    }, USER).then((result) => {
      expect(result).toEqual({ applied: true });
      expect(h.updates[0]!.table).toBe(entity);
      expect(h.updates[0]!.set).toMatchObject(expected);
    });
  });

  it('reports a stale base rather than overwriting a concurrent edit', async () => {
    h.updateReturns = [[]];
    expect(await applyApprovedChange(base, USER)).toEqual({ applied: false, reason: 'stale' });
    expect(h.inserts).toHaveLength(0);
  });
});

describe('POST create staging (#2597)', () => {
  it('does not stage when no rule matches the proposed create', async () => {
    expect(await stageDealCreateResponse(ctx(), { amount: 100 }, { amount: 100 })).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it('admins bypass create staging entirely', async () => {
    h.ruleRows = [rule];
    expect(await stageDealCreateResponse(ctx({ isAdmin: true }), { amount: 20000 }, { amount: 20000 }))
      .toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it('stages a rule-matched create under the canonical name with a reserved id', async () => {
    h.ruleRows = [rule];
    const res = await stageDealCreateResponse(
      ctx(), { amount: 20000, title: 'Big deal' }, { title: 'Big deal', amount: 20000 },
    );
    expect(res?.status).toBe(202);
    await expect(res!.json()).resolves.toMatchObject({
      ok: true, pending: true, current_step: 1,
    });
    const request = h.inserts.find((i) => i.table === 'approval_requests')!;
    expect(request.values).toMatchObject({
      tenantId: TENANT, entityType: 'deals', ruleId: RULE, requestedBy: USER, status: 'pending',
    });
    expect(typeof request.values.entityId).toBe('string');
    expect(request.values.entityId).not.toBe('');
    expect(request.values.pendingData).toMatchObject({
      kind: 'create', body: { title: 'Big deal', amount: 20000 },
    });
  });

  it.each([
    ['contacts', 'contact', stageContactCreateResponse],
    ['leads', 'lead', stageLeadCreateResponse],
    ['companies', 'company', stageCompanyCreateResponse],
    ['tasks', 'task', stageTaskCreateResponse],
  ] as const)('stages a rule-matched %s create', async (entity, singular, stage) => {
    h.ruleRows = [{ ...rule, entityType: singular }];
    const res = await stage(ctx(), { amount: 20000 }, { title: 'staged' });
    expect(res?.status).toBe(202);
    const request = h.inserts.find((i) => i.table === 'approval_requests')!;
    expect(request.values.entityType).toBe(entity);
    expect(request.values.pendingData).toMatchObject({ kind: 'create' });
  });
});

describe('applyApprovedChange — staged creates (#2597)', () => {
  const createBase = {
    id: 'req-create', tenantId: TENANT, entityType: 'deals', entityId: DEAL,
    status: 'approved', requestedBy: USER,
    pendingData: { kind: 'create', body: { title: 'Approved', amount: 20000, stage_id: 'stage-1' } },
  };

  it('inserts the row with the reserved id, tenant and creator, and counts the deal', async () => {
    expect(await applyApprovedChange(createBase, USER)).toEqual({ applied: true });
    const row = h.inserts.find((i) => i.table === 'deals')!;
    expect(row.values).toMatchObject({
      id: DEAL, tenantId: TENANT, createdBy: USER, title: 'Approved', amount: '20000',
      stageId: 'stage-1',
    });
    expect(h.updates.some((u) => u.table === 'tenants')).toBe(true);
    expect(h.inserts.some((i) => i.table === 'activities')).toBe(true);
  });

  it('does not touch a quota counter for non-deal creates', async () => {
    expect(await applyApprovedChange({
      ...createBase, entityType: 'companies',
      pendingData: { kind: 'create', body: { name: 'Acme' } },
    }, USER)).toEqual({ applied: true });
    expect(h.updates.some((u) => u.table === 'tenants')).toBe(false);
  });

  it('is idempotent when the reserved row already exists', async () => {
    h.insertReturns = [[]];
    expect(await applyApprovedChange(createBase, USER))
      .toEqual({ applied: false, reason: 'already_applied' });
    expect(h.updates.some((u) => u.table === 'tenants')).toBe(false);
    expect(h.inserts.some((i) => i.table === 'activities')).toBe(false);
  });
});

describe('#2597 A3 wiring anti-rot', () => {
  const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
  it('the deal PATCH stages and both decision endpoints replay', () => {
    expect(read('app/api/tenant/deals/[id]/route.ts')).toMatch(/stageDealPatchResponse\(/);
    expect(read('app/api/tenant/contacts/[id]/route.ts')).toMatch(/stageContactPatchResponse\(/);
    for (const [entity, fn] of [
      ['leads', 'stageLeadPatchResponse'],
      ['companies', 'stageCompanyPatchResponse'],
      ['tasks', 'stageTaskPatchResponse'],
    ] as const) {
      expect(read(`app/api/tenant/${entity}/[id]/route.ts`)).toMatch(new RegExp(`${fn}\\(`));
    }
    expect(read('app/api/tenant/approvals/[id]/route.ts')).toMatch(/applyApprovedChange\(/);
    expect(read('app/api/tenant/permissions/approvals/route.ts')).toMatch(/applyApprovedChange\(/);
  });

  it('every entity POST stages rule-matched creates', () => {
    for (const [entity, fn] of [
      ['deals', 'stageDealCreateResponse'],
      ['contacts', 'stageContactCreateResponse'],
      ['leads', 'stageLeadCreateResponse'],
      ['companies', 'stageCompanyCreateResponse'],
      ['tasks', 'stageTaskCreateResponse'],
    ] as const) {
      expect(read(`app/api/tenant/${entity}/route.ts`)).toMatch(new RegExp(`${fn}\\(`));
    }
  });
});

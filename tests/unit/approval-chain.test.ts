import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the DB transaction so we can drive approveRequest/rejectRequest and
// capture the update payloads (the multi-step advance logic, #1632). ──────────

// The single row the SELECT inside the transaction returns.
let currentRow: Record<string, unknown> | undefined;
// Captured .set() payloads from tx.update(approvalRequests).set(...).
const updates: Record<string, unknown>[] = [];
// Captured activities inserts.
const activityInserts: Record<string, unknown>[] = [];

function makeTx() {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(currentRow ? [currentRow] : []) }) }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        updates.push(payload);
        // Return the row merged with the update, as .returning() would.
        return { where: () => ({ returning: () => Promise.resolve([{ ...currentRow, ...payload }]) }) };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (String(table) === 'activities') activityInserts.push(vals);
        return { returning: () => Promise.resolve([{ id: 'x', ...vals }]) };
      },
    }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(makeTx())),
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  approvalRequests: { toString: () => 'approval_requests', id: 'id', status: 'status' },
}));
vi.mock('@/drizzle/schema/infra', () => ({
  activities: { toString: () => 'activities' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
}));

import { approveRequest, rejectRequest } from '@/lib/rbac/approval-workflows';

function baseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1', tenantId: 't1', entityType: 'deal', entityId: 'd1',
    ruleId: 'rule-1', status: 'pending', requestedBy: 'u0',
    approvedBy: null, rejectedBy: null, reason: null,
    steps: [], currentStep: 1, ...over,
  };
}

const chain = () => ([
  { order: 1, approverRole: 'manager', status: 'pending', actedBy: null, actedAt: null, reason: null },
  { order: 2, approverRole: 'finance', status: 'pending', actedBy: null, actedAt: null, reason: null },
  { order: 3, approverRole: 'vp', status: 'pending', actedBy: null, actedAt: null, reason: null },
]);

describe('approval chains (#1632)', () => {
  beforeEach(() => {
    updates.length = 0;
    activityInserts.length = 0;
    currentRow = undefined;
  });

  it('legacy single-stage: one approve finalizes to approved', async () => {
    currentRow = baseRow({ steps: [] });
    await approveRequest('req-1', 'mgr');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'approved', approvedBy: 'mgr' });
    expect(activityInserts[0]).toMatchObject({ eventType: 'approval_approved' });
  });

  it('multi-step: approving step 1 advances to step 2 and stays pending', async () => {
    currentRow = baseRow({ steps: chain(), currentStep: 1 });
    await approveRequest('req-1', 'mgr');
    const set = updates[0]!;
    // Not finalized.
    expect(set.status).toBeUndefined();
    expect(set.currentStep).toBe(2);
    const steps = set.steps as Array<Record<string, unknown>>;
    expect(steps[0]).toMatchObject({ order: 1, status: 'approved', actedBy: 'mgr' });
    expect(steps[1]).toMatchObject({ order: 2, status: 'pending' });
    expect(activityInserts[0]).toMatchObject({ eventType: 'approval_step_approved' });
  });

  it('multi-step: approving the FINAL step flips the request to approved', async () => {
    currentRow = baseRow({ steps: chain().map((s, i) => i < 2 ? { ...s, status: 'approved' } : s), currentStep: 3 });
    await approveRequest('req-1', 'vp');
    const set = updates[0]!;
    expect(set.status).toBe('approved');
    expect(set.approvedBy).toBe('vp');
    const steps = set.steps as Array<Record<string, unknown>>;
    expect(steps[2]).toMatchObject({ order: 3, status: 'approved', actedBy: 'vp' });
    expect(activityInserts[0]).toMatchObject({ eventType: 'approval_approved' });
  });

  it('multi-step: rejecting at any step rejects the whole request and records the step', async () => {
    currentRow = baseRow({ steps: chain(), currentStep: 2 });
    await rejectRequest('req-1', 'fin', 'over budget');
    const set = updates[0]!;
    expect(set.status).toBe('rejected');
    expect(set.rejectedBy).toBe('fin');
    expect(set.reason).toBe('over budget');
    const steps = set.steps as Array<Record<string, unknown>>;
    expect(steps[1]).toMatchObject({ order: 2, status: 'rejected', actedBy: 'fin', reason: 'over budget' });
    expect(activityInserts[0]).toMatchObject({ eventType: 'approval_rejected' });
  });

  it('returns undefined when the request is not pending (no row)', async () => {
    currentRow = undefined;
    const res = await approveRequest('req-1', 'mgr');
    expect(res).toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});

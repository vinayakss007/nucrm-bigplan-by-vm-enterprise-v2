/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for lib/automation/stage-change-hooks.ts (#672).
 *
 * runStageChangeHooks() fans out to three side-effecting hooks (activity log,
 * assignee notification, auto-created stage task) via Promise.allSettled, so a
 * single hook failure must not abort the others. These tests were at 0%
 * coverage; they assert each hook's concrete side effect, the stage->task
 * mapping (incl. the skip case), the won-vs-other due-date/priority split, the
 * assignee fallback, and the error-isolation guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const activityInsert = vi.fn().mockResolvedValue(undefined);
const taskInsert = vi.fn().mockResolvedValue(undefined);
const notifyDealStageChange = vi.fn().mockResolvedValue(undefined);

vi.mock('@/drizzle/schema', () => ({ tasks: 'tasks', activities: 'activities' }));
vi.mock('@/drizzle/relations', () => ({}));
vi.mock('@/lib/notifications/deal-stage-change', () => ({
  notifyDealStageChange: (...a: unknown[]) => notifyDealStageChange(...a),
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === 'activities') return activityInsert(vals);
        if (table === 'tasks') return taskInsert(vals);
        return Promise.resolve();
      },
    }),
  },
}));

import { runStageChangeHooks } from '@/lib/automation/stage-change-hooks';

const baseCtx = {
  dealId: 'd-1',
  dealTitle: 'Acme Expansion',
  tenantId: 't-1',
  userId: 'u-1',
  assignedTo: 'u-2',
  contactId: 'c-1',
  fromStage: 'Lead',
  toStage: 'Proposal',
  amount: '5000',
};

beforeEach(() => vi.clearAllMocks());

describe('runStageChangeHooks — activity log', () => {
  it('always logs a stage-change activity scoped to the tenant/deal', async () => {
    await runStageChangeHooks(baseCtx);
    expect(activityInsert).toHaveBeenCalledTimes(1);
    const v = activityInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.tenantId).toBe('t-1');
    expect(v.entityType).toBe('deal');
    expect(v.action).toBe('stage_change');
    expect(v.description).toContain('Lead');
    expect(v.description).toContain('Proposal');
  });
});

describe('runStageChangeHooks — assignee notification', () => {
  it('notifies the assignee with the transition details', async () => {
    await runStageChangeHooks(baseCtx);
    expect(notifyDealStageChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: 'd-1',
        tenantId: 't-1',
        assignedTo: 'u-2',
        fromStage: 'Lead',
        toStage: 'Proposal',
        changedBy: 'u-1',
      }),
    );
  });
});

describe('runStageChangeHooks — auto-created stage task', () => {
  it('creates a task for a mapped stage (proposal) with medium priority and +3d due date', async () => {
    await runStageChangeHooks({ ...baseCtx, toStage: 'Proposal' });
    expect(taskInsert).toHaveBeenCalledTimes(1);
    const v = taskInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.title).toContain('Prepare and send proposal');
    expect(v.priority).toBe('medium');
    const due = v.dueDate as Date;
    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(3);
  });

  it('creates a high-priority task due in +1d for a won stage', async () => {
    await runStageChangeHooks({ ...baseCtx, toStage: 'Closed Won' });
    const v = taskInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.priority).toBe('high');
    expect(v.title).toContain('welcome package');
    const due = v.dueDate as Date;
    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(1);
  });

  it('matches stage names case-insensitively', async () => {
    await runStageChangeHooks({ ...baseCtx, toStage: 'NEGOTIATION' });
    expect(taskInsert).toHaveBeenCalledTimes(1);
    expect((taskInsert.mock.calls[0]![0] as Record<string, unknown>).title).toContain('negotiation call');
  });

  it('does NOT create a task for an unmapped stage', async () => {
    await runStageChangeHooks({ ...baseCtx, toStage: 'Qualification' });
    expect(taskInsert).not.toHaveBeenCalled();
    // but the other two hooks still ran
    expect(activityInsert).toHaveBeenCalledTimes(1);
    expect(notifyDealStageChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to userId as assignee when assignedTo is null', async () => {
    await runStageChangeHooks({ ...baseCtx, assignedTo: null, toStage: 'won' });
    const v = taskInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.assignedTo).toBe('u-1');
  });
});

describe('runStageChangeHooks — error isolation', () => {
  it('does not throw and still runs the other hooks when one hook rejects', async () => {
    notifyDealStageChange.mockRejectedValueOnce(new Error('notify boom'));
    await expect(runStageChangeHooks({ ...baseCtx, toStage: 'Proposal' })).resolves.toBeUndefined();
    // activity + task hooks still executed despite the notify failure
    expect(activityInsert).toHaveBeenCalledTimes(1);
    expect(taskInsert).toHaveBeenCalledTimes(1);
  });
});

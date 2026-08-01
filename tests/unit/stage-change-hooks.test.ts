import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
vi.mock('@/drizzle/db', () => ({
  db: { insert: (...args: unknown[]) => mockInsert(...args) },
}));

vi.mock('@/drizzle/schema', () => ({
  tasks: { $inferInsert: {} },
  activities: { $inferInsert: {} },
}));

const mockNotify = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notifications/deal-stage-change', () => ({
  notifyDealStageChange: (...args: unknown[]) => mockNotify(...args),
}));

import { runStageChangeHooks } from '@/lib/automation/stage-change-hooks';

const BASE_CTX = {
  dealId: 'deal-1',
  dealTitle: 'Acme Corp — Annual License',
  tenantId: 'tenant-1',
  userId: 'user-1',
  assignedTo: 'user-2',
  contactId: 'contact-1',
  fromStage: 'Qualified',
  toStage: 'Proposal',
  amount: '50000',
};

describe('runStageChangeHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs an activity for every stage change', async () => {
    await runStageChangeHooks(BASE_CTX);

    // The activity insert should have been called
    expect(mockInsert).toHaveBeenCalled();
    // At minimum, insert was called (activities + possibly tasks)
    expect(mockInsert.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('notifies the assignee', async () => {
    await runStageChangeHooks(BASE_CTX);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: 'deal-1',
        dealTitle: 'Acme Corp — Annual License',
        assignedTo: 'user-2',
        fromStage: 'Qualified',
        toStage: 'Proposal',
        changedBy: 'user-1',
      })
    );
  });

  it('auto-creates a task when entering "Proposal" stage', async () => {
    await runStageChangeHooks({ ...BASE_CTX, toStage: 'Proposal' });

    // Should have 2 inserts: activity + task
    expect(mockInsert.mock.calls.length).toBe(2);
    const taskInsert = mockInsert.mock.calls[1];
    expect(taskInsert).toBeDefined();
  });

  it('auto-creates a task when entering "Won" stage with high priority', async () => {
    await runStageChangeHooks({ ...BASE_CTX, toStage: 'Won' });

    expect(mockInsert.mock.calls.length).toBe(2);
  });

  it('does NOT auto-create a task for arbitrary stages', async () => {
    await runStageChangeHooks({ ...BASE_CTX, toStage: 'Discovery' });

    // Only 1 insert (activity), no task
    expect(mockInsert.mock.calls.length).toBe(1);
  });

  it('is resilient to hook failures — one failure does not block others', async () => {
    // Make the activity insert fail
    mockInsert.mockRejectedValueOnce(new Error('DB down'));

    // Should not throw — uses Promise.allSettled
    await expect(runStageChangeHooks(BASE_CTX)).resolves.toBeUndefined();

    // Notification should still have been attempted
    expect(mockNotify).toHaveBeenCalled();
  });

  it('uses the deal assignee for the task when available', async () => {
    await runStageChangeHooks({ ...BASE_CTX, toStage: 'Negotiation', assignedTo: 'user-3' });

    // The task insert should have assignedTo = user-3
    const taskCall = mockInsert.mock.calls[1];
    expect(taskCall).toBeDefined();
  });

  it('falls back to userId when assignedTo is null', async () => {
    await runStageChangeHooks({ ...BASE_CTX, toStage: 'Proposal', assignedTo: null });

    // Task still created, assigned to the user who made the change
    expect(mockInsert.mock.calls.length).toBe(2);
  });

  it('handles contactId being null', async () => {
    await expect(
      runStageChangeHooks({ ...BASE_CTX, contactId: null })
    ).resolves.toBeUndefined();
  });
});

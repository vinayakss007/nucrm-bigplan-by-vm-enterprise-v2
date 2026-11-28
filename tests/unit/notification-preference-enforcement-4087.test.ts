// @vitest-environment node
/**
 * #4087 — stored notification preferences must gate delivery, not just render
 * checkboxes in Settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  insert: vi.fn(),
  where: vi.fn(),
  from: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn(() => ({ from: m.from })), insert: vi.fn(() => ({ values: m.insert })) },
}));
vi.mock('@/lib/db/rls', () => ({
  withTenantContext: vi.fn(async (_t: string, _u: string, fn: (tx: unknown) => Promise<void>) => {
    await fn({ insert: vi.fn(() => ({ values: m.insert })) });
  }),
}));
vi.mock('@/drizzle/schema', () => ({
  notifications: { userId: 'userId', tenantId: 'tenantId', type: 'type', title: 'title', body: 'body', link: 'link', metadata: 'metadata' },
  tenantMembers: { tenantId: 'tenantId', userId: 'userId', status: 'status', notificationPrefs: 'notification_prefs' },
  users: { id: 'id', fullName: 'fullName', email: 'email' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq'),
  and: vi.fn(() => 'and'),
  ne: vi.fn(() => 'ne'),
  sql: { raw: vi.fn(), join: vi.fn() },
  ilike: vi.fn(),
  or: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { channelEnabled, matrixFromPrefs, DEFAULTS } from '@/lib/notifications/preferences';

describe('#4087 preference resolution', () => {
  it('defaults to delivering when no preference row exists', () => {
    expect(channelEnabled({}, 'task_assigned', 'in_app')).toBe(true);
    expect(DEFAULTS['task.assigned_to_me']!.email).toBe(true);
  });

  it('honours an explicit opt-out and ignores unknown keys', () => {
    const matrix = matrixFromPrefs({ matrix: { 'task.assigned_to_me': { in_app: false, email: false, telegram: false } } });
    expect(channelEnabled(matrix, 'task_assigned', 'in_app')).toBe(false);
    expect(channelEnabled(matrix, 'deal_won', 'in_app')).toBe(true);
  });
});

describe('#4087 delivery enforcement', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    m.from.mockReturnValue({ where: m.where });
    m.where.mockImplementation(async () => m.rows);
    m.insert.mockResolvedValue(undefined);
  });

  it('skips the in-app row when the recipient disabled that channel', async () => {
    m.rows = [{ userId: 'u1', notificationPrefs: { matrix: { 'task.assigned_to_me': { in_app: false } } } }];
    const { createNotification } = await import('@/lib/notifications');
    const ok = await createNotification({ userId: 'u1', tenantId: 't1', type: 'task_assigned', title: 'Muted' });
    expect(ok).toBe(true);
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('still writes when the recipient left the channel on', async () => {
    m.rows = [{ userId: 'u1', notificationPrefs: { matrix: { 'task.assigned_to_me': { in_app: true } } } }];
    const { createNotification } = await import('@/lib/notifications');
    await createNotification({ userId: 'u1', tenantId: 't1', type: 'task_assigned', title: 'Delivered' });
    expect(m.insert).toHaveBeenCalled();
  });

  it('omits opted-out members from tenant fan-out', async () => {
    m.rows = [
      { userId: 'u1', notificationPrefs: { matrix: { 'deal.stage_changed': { in_app: true } } } },
      { userId: 'u2', notificationPrefs: { matrix: { 'deal.stage_changed': { in_app: false } } } },
    ];
    const { notifyTenantMembers } = await import('@/lib/notifications');
    await notifyTenantMembers({ tenantId: 't1', type: 'deal_stage', title: 'Deal moved' });
    expect(m.insert).toHaveBeenCalledWith([expect.objectContaining({ userId: 'u1' })]);
  });
});

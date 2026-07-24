import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockAnd = vi.fn(() => 'mock-and');
const mockEq = vi.fn(() => 'mock-eq');
const mockNe = vi.fn(() => 'mock-ne');

vi.mock('@/lib/db/rls', () => ({
  withTenantContext: vi.fn(async (_tid: string, _uid: string, fn: (tx: unknown) => Promise<void>) => {
    await fn({ insert: mockInsert });
  }),
}));

vi.mock('@/drizzle/schema', () => ({
  notifications: { userId: 'userId', tenantId: 'tenantId', type: 'type', title: 'title', body: 'body', link: 'link', metadata: 'metadata' },
  tenantMembers: { tenantId: 'tenantId', userId: 'userId', status: 'status' },
  users: { id: 'id', fullName: 'fullName', email: 'email' },
}));

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
  and: mockAnd,
  ne: mockNe,
  sql: { raw: vi.fn(), join: vi.fn() },
  ilike: vi.fn(),
  or: vi.fn(),
}));

const mockDbSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('@/drizzle/db', () => ({ db: { select: mockDbSelect } }));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe('notifications', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockInsert.mockReset();
    mockFrom.mockReset();
    mockWhere.mockReset();
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockEq.mockClear();
    mockAnd.mockClear();
    mockNe.mockClear();
  });

  it('createNotification succeeds on first try', async () => {
    mockInsert.mockResolvedValue(undefined);
    const { createNotification } = await import('@/lib/notifications');
    await createNotification({
      userId: 'u1', tenantId: 't1', type: 'task_assigned', title: 'Test',
    });
    expect(mockInsert).toHaveBeenCalled();
  });

  it('createNotification retries once on failure then logs error', async () => {
    mockInsert
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValueOnce(undefined);
    const { createNotification } = await import('@/lib/notifications');
    await createNotification({
      userId: 'u1', tenantId: 't1', type: 'task_assigned', title: 'Test',
    });
    // First call fails, retry succeeds — no error logged (retry succeeded)
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('createNotification logs error when retry also fails', async () => {
    mockInsert.mockRejectedValue(new Error('DB down permanently'));
    const { createNotification } = await import('@/lib/notifications');
    const { logger } = await import('@/lib/logger');
    await createNotification({
      userId: 'u1', tenantId: 't1', type: 'task_assigned', title: 'Test',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retry exhausted'),
      expect.objectContaining({ type: 'task_assigned' }),
    );
  });

  it('notifyTenantMembers retries on failure then logs error', async () => {
    const members = [{ userId: 'u1' }, { userId: 'u2' }];
    mockWhere.mockResolvedValue(members);
    mockInsert.mockRejectedValue(new Error('Insert failed'));
    const { notifyTenantMembers } = await import('@/lib/notifications');
    const { logger } = await import('@/lib/logger');
    await notifyTenantMembers({
      tenantId: 't1', type: 'deal_stage', title: 'Deal moved',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retry exhausted'),
      expect.objectContaining({ type: 'deal_stage' }),
    );
  });

  it('notifyTenantMembers retries and succeeds on second attempt', async () => {
    const members = [{ userId: 'u1' }];
    mockWhere.mockResolvedValue(members);
    mockInsert
      .mockRejectedValueOnce(new Error('Transient'))
      .mockResolvedValueOnce(undefined);
    const { notifyTenantMembers } = await import('@/lib/notifications');
    const { withTenantContext } = await import('@/lib/db/rls');
    await notifyTenantMembers({
      tenantId: 't1', type: 'deal_won', title: 'Won!',
    });
    expect(withTenantContext).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});

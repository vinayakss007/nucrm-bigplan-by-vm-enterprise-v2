import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/drizzle/db', () => ({ db: { select: mockSelect } }));
vi.mock('@/drizzle/schema', () => ({ users: {}, tenants: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

describe('user-defaults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns user pref when valid', async () => {
    mockLimit
      .mockResolvedValueOnce([{ metadata: { prefs: { default_record_view: 'kanban' } } }])
      .mockResolvedValueOnce([{ settings: {} }]);
    const { getUserDefaultView } = await import('@/lib/user-defaults');
    const result = await getUserDefaultView('tenant-1', 'user-1');
    expect(result).toBe('kanban');
  });

  it('falls back to workspace default when user pref missing', async () => {
    mockLimit
      .mockResolvedValueOnce([{ metadata: {} }])
      .mockResolvedValueOnce([{ settings: { user_defaults: { default_record_view: 'card' } } }]);
    const { getUserDefaultView } = await import('@/lib/user-defaults');
    const result = await getUserDefaultView('tenant-1', 'user-1');
    expect(result).toBe('card');
  });

  it('returns list when no defaults configured', async () => {
    mockLimit
      .mockResolvedValueOnce([{ metadata: {} }])
      .mockResolvedValueOnce([{ settings: {} }]);
    const { getUserDefaultView } = await import('@/lib/user-defaults');
    const result = await getUserDefaultView('tenant-1', 'user-1');
    expect(result).toBe('list');
  });

  it('returns list on DB error', async () => {
    mockLimit.mockRejectedValue(new Error('DB down'));
    const { getUserDefaultView } = await import('@/lib/user-defaults');
    const result = await getUserDefaultView('tenant-1', 'user-1');
    expect(result).toBe('list');
  });

  it('ignores invalid view values', async () => {
    mockLimit
      .mockResolvedValueOnce([{ metadata: { prefs: { default_record_view: 'invalid_view' } } }])
      .mockResolvedValueOnce([{ settings: { user_defaults: { default_record_view: 'also_invalid' } } }]);
    const { getUserDefaultView } = await import('@/lib/user-defaults');
    const result = await getUserDefaultView('tenant-1', 'user-1');
    expect(result).toBe('list');
  });
});

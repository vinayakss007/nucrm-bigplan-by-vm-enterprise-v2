/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3730 — saveLayout must read the current default BEFORE clearing isDefault,
 * otherwise the update branch is dead and every save leaks a new row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type UpdateCall = { set: Record<string, unknown>; where: unknown };
const calls: string[] = [];
const updates: UpdateCall[] = [];
const inserts: Record<string, unknown>[] = [];
let existingRow: { id: string; layout: unknown } | null = { id: 'row-1', layout: {} };

vi.mock('@/lib/db', () => ({
  withTenantDb: (_tenant: string, _user: string, fn: (tx: unknown) => Promise<unknown>) => fn({
    query: {
      dashboardLayouts: {
        findFirst: vi.fn(async () => {
          calls.push('read');
          return existingRow;
        }),
      },
    },
    update: (_table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set, where: undefined });
        return {
          where: (_where: unknown) => {
            calls.push('clear-default');
            return Promise.resolve([]);
          },
        };
      },
    }),
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        calls.push('insert');
        inserts.push(values);
        return Promise.resolve([]);
      },
    }),
  }),
}));

vi.mock('@/drizzle/schema/dashboard', () => ({
  dashboardLayouts: { tenantId: 't', userId: 'u', isDefault: 'd', id: 'id', layout: 'l' },
}));
vi.mock('@/drizzle/schema', () => ({}));
vi.mock('@/drizzle/schema/lead-warming', () => ({}));
vi.mock('@/lib/dashboard/layout-defaults', () => ({
  getPlanDefaultLayout: vi.fn(),
  getRoleDefaultLayout: vi.fn(),
}));
vi.mock('@/lib/templates/resolve', () => ({ resolveTemplate: vi.fn() }));

import { saveLayout } from '@/lib/dashboard/layout-resolver';

beforeEach(() => {
  calls.length = 0;
  updates.length = 0;
  inserts.length = 0;
  existingRow = { id: 'row-1', layout: {} };
});

describe('#3730 saveLayout upsert', () => {
  it('reads the current default before clearing isDefault', async () => {
    await saveLayout('tenant-1', 'user-1', { widgets: [] } as never, 'user');
    expect(calls[0]).toBe('read');
    expect(calls[1]).toBe('clear-default');
  });

  it('updates the existing row in place instead of inserting a new one', async () => {
    await saveLayout('tenant-1', 'user-1', { widgets: [] } as never, 'user');
    expect(calls).toContain('clear-default');
    expect(calls).not.toContain('insert');
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(2); // one to clear the flag, one to update the row
  });

  it('inserts a default row only when none exists', async () => {
    existingRow = null;
    await saveLayout('tenant-1', 'user-1', { widgets: [] } as never, 'user');
    expect(calls).toContain('insert');
    expect(inserts).toHaveLength(1);
  });
});

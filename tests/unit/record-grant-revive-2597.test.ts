/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * A revoked record grant is tombstoned. Re-granting the same role/record used
 * to UPDATE that row without clearing deleted_at (or a stale expires_at), so
 * the API answered 201 while every enforcement reader still saw no grant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  setCalls: [] as Record<string, unknown>[],
  whereArgs: [] as unknown[],
  selected: [] as Record<string, unknown>[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (state.existing ? [state.existing] : []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.setCalls.push(values);
          return { where: async () => undefined };
        },
      }),
      insert: () => ({ values: () => ({ returning: async () => [{}] }) }),
    }),
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          state.whereArgs.push(args);
          // Apply the isNull predicates the real query would apply, so a
          // missing tombstone filter is observable as a returned row.
          const nullColumns = new Set<unknown>();
          const walk = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const condition = node as { op?: string; a?: unknown; args?: unknown[] };
            if (condition.op === 'isNull') nullColumns.add(condition.a);
            condition.args?.forEach(walk);
          };
          args.forEach(walk);
          return Promise.resolve(state.selected.filter((row) =>
            [...nullColumns].every((column) => {
              const name = (column as { name?: string } | null)?.name;
              return !name || row[name] == null;
            })
          ));
        },
      }),
    }),
  },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
    and: (...args: unknown[]) => ({ op: 'and', args }),
    or: (...args: unknown[]) => ({ op: 'or', args }),
    gt: (a: unknown, b: unknown) => ({ op: 'gt', a, b }),
    isNull: (a: unknown) => ({ op: 'isNull', a }),
  };
});

import { grantRecordAccess, checkRecordAccess } from '@/lib/rbac/record-permissions';

beforeEach(() => {
  state.existing = null;
  state.setCalls = [];
  state.whereArgs = [];
  state.selected = [];
});

describe('record grant revival after revoke', () => {
  it('clears the tombstone and stale expiry when re-granting a revoked row', async () => {
    state.existing = {
      id: 'grant-1',
      accessLevel: 'none',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    };

    await grantRecordAccess('tenant-1', 'role-1', 'deals', 'deal-1', 'read', 'admin-1');

    expect(state.setCalls).toHaveLength(1);
    expect(state.setCalls[0]).toMatchObject({
      accessLevel: 'read',
      deletedAt: null,
      expiresAt: null,
    });
  });

  it('keeps a live grant unchanged except for its access level', async () => {
    state.existing = { id: 'grant-2', accessLevel: 'read', deletedAt: null, expiresAt: null };

    await grantRecordAccess('tenant-1', 'role-1', 'deals', 'deal-1', 'write', 'admin-1');

    expect(state.setCalls[0]).toMatchObject({ accessLevel: 'write', deletedAt: null });
  });

  it('does not authorize a tombstoned grant through checkRecordAccess', async () => {
    state.selected = [{
      id: 'grant-3',
      accessLevel: 'admin',
      deleted_at: new Date('2026-01-01T00:00:00Z'),
      expires_at: null,
    }];

    const level = await checkRecordAccess('tenant-1', 'user-1', 'role-1', 'deals', 'deal-1');

    expect(level).toBe('none');
  });
});

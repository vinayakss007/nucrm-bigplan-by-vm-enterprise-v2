/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2619 — getFieldRestrictions re-selected field_permissions on every call,
// so a PATCH (write projection + response read projection) paid twice and
// every list GET paid once even for tenants with no restrictions configured.
// The built map is now cached per tenant:role:entity on the same 60 s TTL as
// the role cache; setFieldPermission — the only writer — clears it.

const TENANT = 'd1111111-1111-4111-8111-111111111111';

const mockDb = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }));

function makeBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['from', 'where', 'orderBy', 'limit']) b[m] = chain;
  b['then'] = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
  return b;
}

let queued: unknown[][] = [];
let call = 0;
function queue(...results: unknown[][]) {
  queued = results;
  call = 0;
  mockDb.select.mockImplementation(() => {
    const rows = queued[call] ?? [];
    call += 1;
    return makeBuilder(rows);
  });
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

import {
  getFieldRestrictions,
  enforceFieldWrite,
  __clearRoleIdCache,
  __clearFieldRestrictionsCache,
} from '@/lib/rbac/enforce';
import { setFieldPermission } from '@/lib/rbac/field-permissions';

beforeEach(() => {
  __clearRoleIdCache();
  __clearFieldRestrictionsCache();
  mockDb.select.mockReset();
});

describe('restriction-map cache (#2619)', () => {
  it('serves a configured map from cache on the second lookup', async () => {
    queue(
      [{ id: 'role-1' }],                                              // resolveRoleId
      [{ fieldName: 'amount', accessLevel: 'none' }],                  // field_permissions
    );
    const first = await getFieldRestrictions(TENANT, 'rep', 'deals');
    expect(first?.get('amount')).toBe('none');
    expect(mockDb.select).toHaveBeenCalledTimes(2);

    const second = await getFieldRestrictions(TENANT, 'rep', 'deals');
    expect(second).toBe(first);
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it('caches the negative (no-rows → null) result too', async () => {
    queue([{ id: 'role-1' }], []);
    expect(await getFieldRestrictions(TENANT, 'rep', 'deals')).toBeNull();
    const before = mockDb.select.mock.calls.length;
    expect(await getFieldRestrictions(TENANT, 'rep', 'deals')).toBeNull();
    expect(mockDb.select.mock.calls.length).toBe(before);
  });

  it('a PATCH (write then read projection) queries once, not twice', async () => {
    queue(
      [{ id: 'role-1' }],
      [{ fieldName: 'amount', accessLevel: 'none' }],
    );
    const { body, stripped } = await enforceFieldWrite(
      { tenantId: TENANT, roleSlug: 'rep', isSuperAdmin: false } as never,
      'deals', { title: 'A', amount: '10' },
    );
    expect(stripped).toEqual(['amount']);
    expect(body).toEqual({ title: 'A' });
    const afterWrite = mockDb.select.mock.calls.length;
    await enforceFieldWrite(
      { tenantId: TENANT, roleSlug: 'rep', isSuperAdmin: false } as never,
      'deals', { amount: '10' },
    );
    expect(mockDb.select.mock.calls.length).toBe(afterWrite);
  });

  it('setFieldPermission — the only writer — invalidates the cache', async () => {
    mockDb.transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
      fn({
        select: () => makeBuilder([]),                    // no existing row → insert path
        insert: () => ({ values: () => ({ returning: async () => [{ id: 'fp-1' }] }) }),
        update: () => ({ set: () => ({ where: async () => ({}) }) }),
      }));
    queue(
      [{ id: 'role-1' }],
      [{ fieldName: 'amount', accessLevel: 'none' }],
    );
    await getFieldRestrictions(TENANT, 'rep', 'deals');
    const afterFirst = mockDb.select.mock.calls.length;

    await setFieldPermission(TENANT, 'role-1', 'deals', 'amount', 'read');

    await getFieldRestrictions(TENANT, 'rep', 'deals');
    // One extra select (the field_permissions read; resolveRoleId keeps its own
    // cache) proves the restriction map was rebuilt, not reused.
    expect(mockDb.select.mock.calls.length).toBe(afterFirst + 1);
  });

  it('different entities do not share one cache entry', async () => {
    queue(
      [{ id: 'role-1' }],
      [{ fieldName: 'amount', accessLevel: 'none' }],
      [],                                                  // leads: role cached, no rows
    );
    await getFieldRestrictions(TENANT, 'rep', 'deals');
    expect(await getFieldRestrictions(TENANT, 'rep', 'leads')).toBeNull();
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });
});

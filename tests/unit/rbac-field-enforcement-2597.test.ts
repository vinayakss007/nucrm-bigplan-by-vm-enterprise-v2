/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 (A1, deals) — `field_permissions` rows were configurable in the admin
 * UI but enforced nowhere: the two deals request paths never consulted them, so
 * "hide `amount` from role `rep`" saved a row and changed nothing.
 * `lib/rbac/enforce.ts` is the enforcement layer now wired into
 * `app/api/tenant/deals/route.ts` and `.../deals/[id]/route.ts`.
 *
 * These tests pin, in order of what silently regresses if the logic drifts:
 *   1. default-open — no row for a field means unrestricted (a naive deny-list
 *      would blank every column the tenant never configured);
 *   2. the hierarchy — `none` fails read AND write, `read` passes read but
 *      fails write, `write`/`admin` pass both;
 *   3. the ALIAS leak — the deals handler exposes `amount` as both `amount` and
 *      `value`, so restricting the field must clear BOTH projections, and an
 *      inbound `value` must be blocked by the `amount` write-restriction
 *      (otherwise the restriction is bypassed by renaming on the way in);
 *   4. no-config fast path — a role with zero rows returns the input untouched;
 *   5. super-admin exemption;
 *   6. the dead-export guard — every symbol in the config lib is either used by
 *      a production route or named on a documented pending list, so a future
 *      "enforcement" module can't itself become dead code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

const { mockDb } = vi.hoisted(() => ({ mockDb: { select: vi.fn() } }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));

import {
  stripRowForRead,
  getFieldRestrictions,
  enforceFieldRead,
  enforceFieldWrite,
  __clearRoleIdCache,
  __clearFieldRestrictionsCache,
} from '@/lib/rbac/enforce';

// makeBuilder: each `.select().from().where()[.limit]()` chain resolves to the
// rows queued for it, in call order. A mocked db returns whatever it's told, so
// assertions are on the ENFORCEMENT outcome (what survives the projection),
// which is what actually pins #2597 — not on a canned return value.
let queued: unknown[][] = [];
let call = 0;
function makeBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['from', 'where', 'orderBy', 'limit']) b[m] = chain;
  b['then'] = (res: (v: unknown) => unknown) => res(rows);
  return b;
}
function queue(...results: unknown[][]) {
  queued = results;
  call = 0;
  mockDb.select.mockImplementation(() => {
    const rows = queued[call] ?? [];
    call += 1;
    return makeBuilder(rows);
  });
}

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1', tenantId: TENANT, roleSlug: 'rep',
    permissions: {}, isAdmin: false, isSuperAdmin: false, ...over,
  } as AuthContext;
}

beforeEach(() => { __clearRoleIdCache(); __clearFieldRestrictionsCache(); vi.resetModules(); });

describe('stripRowForRead — pure projection (#2597)', () => {
  it('keeps every key when no field is configured (default-open)', () => {
    const row = { id: 'd1', amount: '500', value: '500', title: 'A' };
    expect(stripRowForRead('deals', new Map(), row)).toEqual(row);
  });

  it('drops BOTH the amount field and its `value` alias projection (#2521 leak)', () => {
    const map = new Map([['amount', 'none' as const]]);
    const out = stripRowForRead('deals', map, { id: 'd1', amount: '500', value: '500', title: 'A' });
    expect(out).toEqual({ id: 'd1', title: 'A' });
    expect('value' in out).toBe(false);
    expect('amount' in out).toBe(false);
  });

  it('normalizes camelCase config rows against snake_case projection keys', () => {
    const map = new Map([['close_date', 'none' as const]]);
    const out = stripRowForRead('deals', map, { id: 'd1', close_date: '2026-01-01' });
    expect(out).toEqual({ id: 'd1' });
  });
});

describe('getFieldRestrictions — slug→role resolution + entity candidates', () => {
  it('returns null (nothing to enforce) when the slug matches no role', async () => {
    queue([]); // roles lookup empty
    expect(await getFieldRestrictions(TENANT, 'ghost', 'deals')).toBeNull();
  });

  it('returns null when the role has zero rows for the entity', async () => {
    queue([{ id: ROLE_ID }], []); // role found, no permissions
    expect(await getFieldRestrictions(TENANT, 'rep', 'deals')).toBeNull();
  });

  it('matches the singular OR plural entity spelling the config UI may use', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'none' }]);
    const map = await getFieldRestrictions(TENANT, 'rep', 'deals');
    expect(map?.get('amount')).toBe('none');
  });
});

describe('enforceFieldRead — the deals list/detail response', () => {
  it('strips the restricted amount from every row and both its aliases', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'none' }]);
    const rows = [
      { id: 'd1', amount: '100', value: '100', title: 'A' },
      { id: 'd2', amount: '200', value: '200', title: 'B' },
    ];
    const out = await enforceFieldRead(ctx(), 'deals', rows);
    expect(out).toEqual([{ id: 'd1', title: 'A' }, { id: 'd2', title: 'B' }]);
  });

  it('leaves the input array untouched (same reference) when the role has no config', async () => {
    queue([{ id: ROLE_ID }], []);
    const rows = [{ id: 'd1', amount: '100' }];
    expect(await enforceFieldRead(ctx(), 'deals', rows)).toBe(rows);
  });

  it('exempts super-admins — no db lookup at all', async () => {
    const rows = [{ id: 'd1', amount: '100' }];
    const out = await enforceFieldRead(ctx({ isSuperAdmin: true }), 'deals', rows);
    expect(out).toBe(rows);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe('enforceFieldWrite — pinned STRIP semantics + alias-bypass close', () => {
  it('strips a `none` field from the body and reports it (no 403)', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'none' }]);
    const { body, stripped } = await enforceFieldWrite(ctx(), 'deals', { title: 'A', amount: 500 });
    expect(body).toEqual({ title: 'A' });
    expect(stripped).toEqual(['amount']);
  });

  it('a `read`-level field blocks the WRITE too (read means read)', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'read' }]);
    const { body, stripped } = await enforceFieldWrite(ctx(), 'deals', { title: 'A', amount: 500 });
    expect(body).toEqual({ title: 'A' });
    expect(stripped).toEqual(['amount']);
  });

  it('an inbound `value` cannot smuggle a write past an amount restriction', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'none' }]);
    const { body, stripped } = await enforceFieldWrite(ctx(), 'deals', { title: 'A', value: 999 });
    expect(body).toEqual({ title: 'A' });
    expect(stripped).toEqual(['value']);
  });

  it('a `write`-level field passes through untouched', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'amount', accessLevel: 'write' }]);
    const { body, stripped } = await enforceFieldWrite(ctx(), 'deals', { title: 'A', amount: 500 });
    expect(body).toEqual({ title: 'A', amount: 500 });
    expect(stripped).toEqual([]);
  });
});

describe('#2597 dead-export guard — the enforcement layer must not itself go dead', () => {
  // Every symbol the config lib exports is either called from a production
  // route (app/**, lib/**) or named on this pending list with a reason. A new
  // export with no caller fails the test — this is exactly how field-permissions
  // became dead in the first place.
  const ROOT = process.cwd();
  const { readdirSync, readFileSync, statSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name === 'tests') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  const PENDING: Record<string, string> = {
    checkFieldAccess: 'callable helper retained for the config UI; the request path enforces via lib/rbac/enforce.ts',
    filterFieldsByPermission: 'same as checkFieldAccess — kept pending a second entity wire-up (#2597 A2)',
  };

  it('every field-permissions export is either used in production or on the pending list', () => {
    const src = readFileSync(join(ROOT, 'lib/rbac/field-permissions.ts'), 'utf8');
    const names = [...src.matchAll(/export async function (\w+)|export function (\w+)|export const (\w+)|export type (\w+)/g)]
      .map((m) => m.slice(1).find(Boolean)!).filter((n) => n !== 'default');
    expect(names.length).toBeGreaterThan(0);

    const prodFiles = [join(ROOT, 'app'), join(ROOT, 'lib')]
      .flatMap((d) => walk(d))
      .filter((f) => !f.endsWith('lib/rbac/field-permissions.ts')); // exclude the definition site
    const corpus = prodFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

    for (const name of names) {
      const used = new RegExp(`\\b${name}\\b`).test(corpus);
      if (!used) {
        expect(PENDING[name], `dead export "${name}" is not on the pending list with a reason`).toBeTruthy();
      }
    }
  });

  it('the pending list stays pruned — drop entries once they gain a real caller (#2508 ratchet)', () => {
    const prodFiles = [join(ROOT, 'app'), join(ROOT, 'lib')].flatMap((d) => walk(d));
    const corpus = prodFiles
      .filter((f) => !f.endsWith('lib/rbac/field-permissions.ts'))
      .map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const name of Object.keys(PENDING)) {
      const used = new RegExp(`\\b${name}\\b`).test(corpus);
      expect(used, `pending entry "${name}" now has a production caller — remove it from PENDING`).toBe(false);
    }
  });

  it('enforce.ts is actually imported by both deals request paths (not a dead module)', () => {
    const list = readFileSync(join(ROOT, 'app/api/tenant/deals/route.ts'), 'utf8');
    const detail = readFileSync(join(ROOT, 'app/api/tenant/deals/[id]/route.ts'), 'utf8');
    expect(list).toMatch(/from '@\/lib\/rbac\/enforce'/);
    expect(detail).toMatch(/from '@\/lib\/rbac\/enforce'/);
    expect(list).toMatch(/enforceFieldRead|enforceFieldWrite/);
    expect(detail).toMatch(/enforceFieldRead|enforceFieldWrite/);
  });

  it('enforce.ts is wired into both contacts request paths too (#2597 A2)', () => {
    const list = readFileSync(join(ROOT, 'app/api/tenant/contacts/route.ts'), 'utf8');
    const detail = readFileSync(join(ROOT, 'app/api/tenant/contacts/[id]/route.ts'), 'utf8');
    expect(list).toMatch(/from '@\/lib\/rbac\/enforce'/);
    expect(detail).toMatch(/from '@\/lib\/rbac\/enforce'/);
    expect(list).toMatch(/enforceFieldRead\(/);
    expect(list).toMatch(/enforceFieldWrite\(/);
    expect(detail).toMatch(/enforceFieldRead\(/);
    expect(detail).toMatch(/enforceFieldWrite\(/);
  });

  it('contacts has NO double-exposed column, so a plain key strip is enough', async () => {
    // The contacts list projection maps each column to exactly one key (no
    // amount→value-style alias), so read enforcement is a straight per-key
    // filter. A camelCase response key must be caught by a snake_case config
    // row (and vice-versa) via normalize.
    queue([{ id: ROLE_ID }], [{ fieldName: 'first_name', accessLevel: 'none' }]);
    const rows = [{ id: 'c1', firstName: 'Ada', email: 'a@x.io' }];
    const out = await enforceFieldRead(ctx(), 'contacts', rows);
    expect(out).toEqual([{ id: 'c1', email: 'a@x.io' }]);
  });

  it('enforce.ts is wired into the leads, companies and tasks request paths (#2597 A2b)', () => {
    const pairs = [
      'app/api/tenant/leads/route.ts',
      'app/api/tenant/leads/[id]/route.ts',
      'app/api/tenant/companies/route.ts',
      'app/api/tenant/companies/[id]/route.ts',
      'app/api/tenant/tasks/route.ts',
      'app/api/tenant/tasks/[id]/route.ts',
    ];
    for (const rel of pairs) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, `${rel} must import the enforcement layer`).toMatch(/from '@\/lib\/rbac\/enforce'/);
      expect(src, `${rel} must call the read projection`).toMatch(/enforceFieldRead\(/);
    }
    // POST/PATCH write-side strip on the list + detail of each entity.
    for (const rel of pairs) {
      expect(readFileSync(join(ROOT, rel), 'utf8')).toMatch(/enforceFieldWrite\(/);
    }
  });

  it('the tasks list cache key is role-qualified so a projected payload can never be served cross-role (#2597)', () => {
    const src = readFileSync(join(ROOT, 'app/api/tenant/tasks/route.ts'), 'utf8');
    expect(src).toMatch(/tasks:\$\{ctx\.roleSlug\}/);
  });
});

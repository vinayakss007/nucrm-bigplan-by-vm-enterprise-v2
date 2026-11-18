/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3405 PR-3A, first slice: `TenantDb` is the branded handle a caller must
 * hold to run tenant-keyed queries, and `withTenantDb` is the only factory.
 * This pin checks the delegation and that the migrated module left the
 * raw-client ledger (a stale ledger entry fails `guard:tenant-db-context`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { tenantId: string; userId: string }[],
  fnRan: 0,
}));

vi.mock('@/lib/db/rls', () => ({
  withTenantContext: async (tenantId: string, userId: string, fn: (db: unknown) => Promise<unknown>) => {
    h.calls.push({ tenantId, userId });
    return fn({ marker: 'bound' });
  },
}));

import { withTenantDb } from '@/lib/db/tenant-client';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

beforeEach(() => { h.calls = []; h.fnRan = 0; });

describe('withTenantDb (#3405)', () => {
  it('delegates to withTenantContext with the tenant and caller identity', async () => {
    const seen = await withTenantDb('tenant-1', 'user-1', async (db) => {
      h.fnRan += 1;
      return db;
    });
    expect(h.calls).toEqual([{ tenantId: 'tenant-1', userId: 'user-1' }]);
    expect(h.fnRan).toBe(1);
    expect(seen).toEqual({ marker: 'bound' });
  });

  it('the migrated RBAC module no longer reaches for the raw client', () => {
    expect(read('lib/rbac/record-scope.ts')).toContain("from '@/lib/db'");
    expect(read('lib/rbac/record-scope.ts')).not.toContain("from '@/drizzle/db'");
    const ledger = JSON.parse(read('scripts/tenant-db-ledger.json'));
    const rbac = Object.values(ledger.groups as Record<string, { files: string[] }>)
      .flatMap((g) => g.files);
    expect(rbac).not.toContain('lib/rbac/record-scope.ts');
    expect(rbac).not.toContain('lib/rbac/enforce.ts');
    expect(rbac).not.toContain('lib/rbac/field-permissions.ts');
  });

  it('the dashboard layout resolver no longer reaches for the raw client', () => {
    expect(read('lib/dashboard/layout-resolver.ts')).toContain("from '@/lib/db'");
    expect(read('lib/dashboard/layout-resolver.ts')).not.toContain("from '@/drizzle/db'");
    const ledger = JSON.parse(read('scripts/tenant-db-ledger.json'));
    expect(ledger.groups).not.toHaveProperty('lib/dashboard');
  });

  it('the activity timeline no longer reaches for the raw client', () => {
    expect(read('lib/activity/timeline.ts')).toContain("from '@/lib/db'");
    expect(read('lib/activity/timeline.ts')).not.toContain("from '@/drizzle/db'");
    const ledger = JSON.parse(read('scripts/tenant-db-ledger.json'));
    expect(ledger.groups).not.toHaveProperty('lib/activity');
  });

  it('the formula sync service no longer reaches for the raw client', () => {
    expect(read('lib/formula/sync.ts')).toContain("from '@/lib/db'");
    expect(read('lib/formula/sync.ts')).not.toContain("from '@/drizzle/db'");
    const ledger = JSON.parse(read('scripts/tenant-db-ledger.json'));
    expect(ledger.groups).not.toHaveProperty('lib/formula');
  });
});

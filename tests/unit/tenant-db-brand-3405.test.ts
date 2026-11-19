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

  // Every module migrated so far: it must use the branded client and have no
  // entry in the shrink-only ledger (a stale entry fails guard:tenant-db-context).
  it.each([
    'lib/rbac/record-scope.ts',
    'lib/rbac/enforce.ts',
    'lib/rbac/field-permissions.ts',
    'lib/dashboard/layout-resolver.ts',
    'lib/activity/timeline.ts',
    'lib/formula/sync.ts',
    'lib/compliance/stale-requests.ts',
    'lib/segments/evaluate.ts',
    'lib/ai/at-risk.ts',
    'lib/ai/activity-log.ts',
    'lib/analytics/entitlement.ts',
    'lib/calendar-sync/service.ts',
    'lib/usage/notifications.ts',
    'lib/lead-scoring/auto-recalculate.ts',
    'lib/usage/tracker.ts',
  ])('%s no longer reaches for the raw client', (file) => {
    expect(read(file)).toContain("from '@/lib/db'");
    expect(read(file)).not.toContain("from '@/drizzle/db'");
    const ledger = JSON.parse(read('scripts/tenant-db-ledger.json'));
    const listed = Object.values(ledger.groups as Record<string, { files: string[] }>)
      .flatMap((g) => g.files);
    expect(listed).not.toContain(file);
  });
});

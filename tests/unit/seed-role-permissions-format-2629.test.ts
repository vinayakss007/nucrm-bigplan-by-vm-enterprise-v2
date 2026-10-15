/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// #2629 — seed-dev.ts created roles with coarse permission maps
// ({ deals: 'full' }) while can() in lib/auth/middleware.ts only honors
// dotted booleans ({ 'deals.view': true }) plus the 'all' wildcard. The
// formats had zero overlap: a seeded sales_rep logged in fine and then 403'd
// on every deal/task/lead endpoint. These tests pin both halves of the
// contract: what can() accepts, and the shape the seed is allowed to write.

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'limit']) b[m] = () => b;
      b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok);
      return b;
    },
  },
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const { can, requirePerm } = await import('@/lib/auth/middleware');type AuthContext = Parameters<typeof can>[0];

function ctx(permissions: Record<string, unknown>): AuthContext {
  return {
    userId: 'u-1', tenantId: 't-1', roleSlug: 'sales_rep',
    permissions, isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

describe('can() permission vocabulary (the contract seeds must match)', () => {
  it('accepts dotted boolean keys', () => {
    expect(can(ctx({ 'deals.view': true }), 'deals.view')).toBe(true);
    expect(requirePerm(ctx({ 'deals.view': true }), 'deals.view')).toBeNull();
  });

  it('ignores the coarse shape — why the old seed was dead', () => {
    expect(can(ctx({ deals: 'full' }), 'deals.view')).toBe(false);
    expect((requirePerm(ctx({ deals: 'full' }), 'deals.view') as Response).status).toBe(403);
  });

  it("honors the 'all' wildcard", () => {
    expect(can(ctx({ all: true }), 'deals.delete')).toBe(true);
  });
});

describe('seed-dev.ts role permission maps match the can() vocabulary (#2629)', () => {
  const src = readFileSync('scripts/seed-dev.ts', 'utf8');
  const maps = [...src.matchAll(/permissions: \{([\s\S]*?)\}/g)].map((m) => m[1] ?? '');

  it('parses at least the four seeded roles', () => {
    expect(maps.length).toBeGreaterThanOrEqual(4);
  });

  it('every key is dotted (or "all") and every value is boolean true', () => {
    for (const map of maps) {
      const entries = [...map.matchAll(/'([^']+)':\s*([A-Za-z'"_]+)/g)];
      expect(entries.length).toBeGreaterThan(0);
      for (const [, key, value] of entries) {
        expect(key).toMatch(/^(all|([a-z_]+\.[a-z_]+))$/);
        expect(value).toBe('true');
      }
    }
  });

  it('sales_rep can read, edit and assign the deals/tasks surface its routes check', () => {
    const repBlock = src.slice(src.indexOf("slug: 'sales_rep'"), src.indexOf("slug: 'member'"));
    const perms = (repBlock.match(/permissions: \{([\s\S]*?)\}/)?.[1] ?? '');
    for (const p of ['deals.view', 'deals.edit', 'deals.assign', 'tasks.view', 'tasks.edit', 'contacts.view', 'leads.view']) {
      expect(perms).toContain(`'${p}': true`);
    }
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3303 — rule 2 of the RLS route-coverage guard reads one source line at a time,
 * so a drizzle chain that puts its receiver on the previous line is invisible to
 * it. `app/api/scim/v2/Users/route.ts:122` was exactly that shape:
 *
 *     const [countResult] = await db
 *       .select({ count: sql`count(*)` })
 *       .from(users)
 *       .innerJoin(tenantMembers, …)
 *
 * `BARE_POOL_RE` needs `db` and `.select` in the same line, so the guard answered
 * "no anonymous route touches an identity table on the bare pool" while SCIM did
 * it twice per handler. Measured on `9e186db0e`, fusing the continuation lines
 * surfaced **10** statements in **2** files — the two the issue names — and
 * nothing else in 518 routes, which is what made this a real blind spot rather
 * than a wider net.
 *
 * The privilege half of #3303 landed in the same branch: both SCIM routes now run
 * inside `withScimTenantContext` and migration 0143 adds the two narrow `users`
 * arms that context keys on. So the real tree reports nothing, the two
 * `rls-preauth-baseline.json` allowances are gone, and what remains here is the
 * proof that the fusion still *would* see the shape — exercised on fixtures, not
 * on the live tree. scim-tenant-context-3303.test.ts owns the fix's own
 * assertions; this file keeps the guard honest about the chain it was written for.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyse, readBaseline } from '../../scripts/check-rls-route-coverage.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'rls-preauth-baseline.json');
const SCIM_LIST = 'app/api/scim/v2/Users/route.ts';
const SCIM_ITEM = 'app/api/scim/v2/Users/[id]/route.ts';

const baseline = readBaseline(BASELINE_PATH);
const current = analyse({ root: ROOT, baseline });
const raw = analyse({ root: ROOT, baseline: {} });

const hitsIn = (file) => raw.hits.filter((h) => h.file === file);

/** A one-route repository, so a guard rule can be watched failing. */
function fixture(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rls-chain-'));
  const routeDir = join(dir, 'app', 'api', 'probe');
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'route.ts'), body);
  return dir;
}

describe('the fusion still sees the SCIM chain its fixtures reproduce (#3303)', () => {
  it('reports a receiver line, and names the identity table, for the list-handler shape', () => {
    const dir = fixture(
      'const [countResult] = await db\n'
      + '  .select({ count: sql`count(*)` })\n'
      + '  .from(users)\n'
      + '  .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id));\n',
    );
    try {
      const hits = analyse({ root: dir, baseline: {} }).hits;
      expect(hits).toHaveLength(1);
      // The line a human has to open in the editor is the receiver's, not the fused one.
      expect(hits[0].line).toBe(1);
      expect(hits[0].detail.split(' ')[0]).toBe('users');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no longer finds that chain in the real tree, because #3303 moved it under a context', () => {
    expect(hitsIn(SCIM_LIST)).toEqual([]);
    expect(hitsIn(SCIM_ITEM)).toEqual([]);
  });

  it('does not invent findings anywhere else in app/api', () => {
    // The 3 cron routes that used to be on this list are not anonymous-surface
    // sites: they run their reads inside `sweepTenants`, which pins one connection
    // and sets `app.current_tenant` / `app.current_user` on it for the whole sweep
    // — see rls-guard-credits-cron-sweep-3315.test.ts. Anything beyond that would
    // be the fusion matching a chain that was never on a pool.
    expect(raw.hits).toEqual([]);
  });
});

describe('the ten allowances are retired, not left excusing nothing', () => {
  it('runs green with no tolerance and no findings', () => {
    expect(current.findings).toEqual([]);
    expect(current.allowed).toBe(0);
  });

  it('keeps no SCIM count and no SCIM reason behind', () => {
    expect(Object.keys(baseline).filter((k) => k.includes('scim'))).toEqual([]);
    expect(Object.keys(baseline._reasons ?? {}).filter((k) => k.includes('scim'))).toEqual([]);
  });
});

describe('rule 1 now judges a route whose token names the tenant', () => {
  it('no longer lists SCIM among the routes it cannot judge', () => {
    // Rule 1's gate used to be `requireAuth(` / `requireTenantCtx(` alone, so a
    // route that authenticated by verifying a tenant-naming token was skipped in
    // silence. `verifySCIMToken` is now a mechanism rule 1 knows to ask about.
    expect(Array.isArray(current.skippedAuthenticators)).toBe(true);
    const files = current.skippedAuthenticators.map((s) => s.file);
    expect(files).not.toContain(SCIM_LIST);
    expect(files).not.toContain(SCIM_ITEM);
    for (const s of current.skippedAuthenticators) {
      expect(s.mechanisms.length).toBeGreaterThan(0);
      expect(s.file).toMatch(/^app\/api\//);
    }
  });

  it('does not pad the list with routes that call requireAuth', () => {
    const withRequireAuth = current.skippedAuthenticators.filter((s) =>
      readFileSync(join(ROOT, s.file), 'utf8').includes('requireAuth('));
    expect(withRequireAuth).toEqual([]);
  });
});

describe('the fusion cannot fire on things that are not chains', () => {
  const CASES = [
    {
      name: 'a receiver that ends a statement',
      body: `const total = await db.select({ c: sql\`count(*)\` }).from(sessions);\n`,
    },
    {
      name: 'a callback handle, not the pool',
      body: `await withTenantContext(tid, (tx) => tx\n  .select({ id: users.id })\n  .from(users));\n`,
    },
    {
      name: 'an object literal that happens to end in the word db',
      body: `const cfg = { name: "db" };\n  .select({ id: sessions.id })\n  .from(sessions);\n`,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const dir = fixture(c.body);
      try {
        const r = analyse({ root: dir, baseline: {} });
        // The first case is a genuine single-line hit and must stay exactly one;
        // the others must produce nothing at all.
        expect(r.hits.length).toBeLessThanOrEqual(c.body.includes('db.select(') ? 1 : 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('still needs the identity table inside the statement window', () => {
    const dir = fixture('const rows = await db\n  .select({ id: deals.id })\n  .from(deals);\n');
    try {
      expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is exercised by a fixture the repo can check against the real tree', () => {
    // A guard fix that only ever runs against the live tree cannot be seen failing.
    const dir = fixture('const rows = await db\n  .select({ id: users.id })\n  .from(users)\n  .where(eq(users.tenantId, tid));\n');
    try {
      const hits = analyse({ root: dir, baseline: {} }).hits;
      expect(hits.length).toBe(1);
      expect(hits[0].line).toBe(1);
      expect(hits[0].detail).toContain('users');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

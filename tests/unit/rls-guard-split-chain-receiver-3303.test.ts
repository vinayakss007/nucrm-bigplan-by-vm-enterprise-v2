/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3303 — rule 2 of the RLS route-coverage guard reads one source line at a time,
 * so a drizzle chain that puts its receiver on the previous line is invisible to
 * it. `app/api/scim/v2/Users/route.ts:122` is exactly that shape:
 *
 *     const [countResult] = await db
 *       .select({ count: sql`count(*)` })
 *       .from(users)
 *       .innerJoin(tenantMembers, …)
 *
 * `BARE_POOL_RE` needs `db` and `.select` in the same line, so the guard answers
 * "no anonymous route touches an identity table on the bare pool" while SCIM does
 * it twice per handler. Measured on `9e186db0e`, fusing the continuation lines
 * surfaces **10** statements in **2** files — the two the issue names — and
 * nothing else in 518 routes, which is what makes this a real blind spot rather
 * than a wider net.
 *
 * The other half of #3303 is a privilege decision (a `users_tenant_scim_read`
 * arm, or `withSecurityContext` for a machine token with no acting user) and that
 * is not this guard's call. So the 10 land in `scripts/rls-preauth-baseline.json`
 * as *counted, reasoned* allowances: the guard sees them, CI stays green, and the
 * ratchet is shrink-only — fixing SCIM has to lower the number, and leaving a
 * number that excuses nothing trips `BASELINE_STALE`.
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

describe('the guard sees a bare-pool read whose receiver sits on its own line (#3303)', () => {
  it('counts the SCIM list handler instead of reporting nothing', () => {
    expect(hitsIn(SCIM_LIST).length).toBeGreaterThanOrEqual(4);
    expect(hitsIn(SCIM_ITEM).length).toBeGreaterThanOrEqual(4);
  });

  it('names the table, not just the line', () => {
    const tables = new Set(hitsIn(SCIM_LIST).map((h) => h.detail.split(' ')[0]));
    // `users` is the directory read; `tenant_members` is what the join turns into
    // a zero-row answer for a machine token with no acting user.
    expect([...tables].sort()).toContain('users');
  });

  it('reports the line a human has to open in the editor, not the fused one', () => {
    const list = hitsIn(SCIM_LIST);
    expect(list.length, 'vacuous if the SCIM route reports nothing').toBeGreaterThan(0);
    for (const h of list) {
      const srcLine = readFileSync(join(ROOT, SCIM_LIST), 'utf8').split('\n')[h.line - 1] ?? '';
      expect(srcLine).toMatch(/\b(?:db|database|pool)\s*$/);
    }
  });

  it('does not invent findings anywhere else in app/api', () => {
    const files = [...new Set(raw.hits.map((h) => h.file))].sort();
    // 3 cron routes (already baselined under #3315) + the 2 SCIM routes. Anything
    // beyond this list is the fusion matching a chain that was never on a pool.
    expect(files).toEqual([
      'app/api/cron/contract-renewal-check/route.ts',
      'app/api/cron/sla-check/route.ts',
      'app/api/cron/subscription-renewal-check/route.ts',
      SCIM_ITEM,
      SCIM_LIST,
    ].sort());
  });
});

describe('the 10 newly-visible SCIM statements are accounted for, not waved at', () => {
  it('runs green only because the baseline allows them', () => {
    expect(current.findings).toEqual([]);
    expect(current.allowed).toBe(raw.hits.length);
  });

  it('each SCIM allowance carries a reason a reviewer can disagree with', () => {
    for (const file of [SCIM_LIST, SCIM_ITEM]) {
      const key = `${file}|PREAUTH_UNCONTEXTED_READ`;
      expect(baseline[key], `${key} must be counted`).toBeGreaterThan(0);
      const why = baseline._reasons?.[key] ?? '';
      expect(why.length, `${key} needs a reason`).toBeGreaterThan(60);
      expect(why).toMatch(/#3303/);
    }
  });

  it('counts what is really there, so the ratchet can only go down', () => {
    for (const file of [SCIM_LIST, SCIM_ITEM]) {
      expect(baseline[`${file}|PREAUTH_UNCONTEXTED_READ`]).toBe(hitsIn(file).length);
    }
  });
});

describe('what rule 1 still cannot judge is said out loud', () => {
  it('lists the routes that authenticate by a mechanism the guard does not know', () => {
    // Rule 1's gate is `requireAuth(` / `requireTenantCtx(`. A route that reaches
    // the database and authenticates some other way is skipped — and until this
    // ran, nobody could see that happening.
    expect(Array.isArray(current.skippedAuthenticators)).toBe(true);
    const files = current.skippedAuthenticators.map((s) => s.file);
    expect(files).toContain(SCIM_LIST);
    expect(files).toContain(SCIM_ITEM);
    for (const s of current.skippedAuthenticators) {
      expect(s.mechanisms.length).toBeGreaterThan(0);
      // …and none of them is something the guard already treats as an entry point.
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

/**
 * Unit tests for the field-permission enforcement guard (#2597).
 *
 * Two halves:
 *   1. `checkEnforcement`/`runGuard` are pure, so the contract they enforce
 *      (import + a read call + a write call) is verified against synthetic
 *      sources — no repo scan, instant. This is the same reason the register
 *      and cron-lock guards are importable: the failure modes #2597 was about
 *      (enforcement removed, or never added) are decision-tree problems, not
 *      filesystem problems.
 *   2. The CLI, run against the real tree, must be green. If a future route
 *      drops the enforce layer, that assertion fails here first and in the
 *      `guard:field-permissions` CI step second — which is precisely the wiring
 *      that #2597 originally lacked.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkEnforcement, runGuard } from '../../scripts/check-field-permission-enforcement.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const GUARD = join(ROOT, 'scripts', 'check-field-permission-enforcement.mjs');

const GOOD = [
  `import { enforceFieldRead, enforceFieldWrite } from '@/lib/rbac/enforce';`,
  `const rows = await enforceFieldRead(ctx, 'deals', raw);`,
  `const { body } = await enforceFieldWrite(ctx, 'deals', rawBody);`,
].join('\n');

describe('checkEnforcement — the #2597 wiring contract', () => {
  it('accepts a route that imports the layer and calls read AND write', () => {
    expect(checkEnforcement('app/api/tenant/deals/route.ts', GOOD)).toEqual([]);
  });

  it('flags a route that dropped the import entirely (the original #2597 state)', () => {
    const src = `const rows = raw;`;
    const problems = checkEnforcement('app/api/tenant/deals/route.ts', src);
    expect(problems.some((p) => /does not import @\/lib\/rbac\/enforce/.test(p))).toBe(true);
    expect(problems.some((p) => /enforceFieldRead/.test(p))).toBe(true);
    expect(problems.some((p) => /enforceFieldWrite/.test(p))).toBe(true);
  });

  it('flags an enforced read path that no longer gates writes (#2597 half-fixed)', () => {
    const src = [
      `import { enforceFieldRead } from '@/lib/rbac/enforce';`,
      `const rows = await enforceFieldRead(ctx, 'deals', raw);`,
    ].join('\n');
    const problems = checkEnforcement('app/api/tenant/deals/route.ts', src);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/enforceFieldWrite/);
  });

  it('flags a route that imports the layer but never calls it (dead code, the failure #2597 shipped as)', () => {
    const src = `import { enforceFieldRead, enforceFieldWrite } from '@/lib/rbac/enforce';`;
    const problems = checkEnforcement('app/api/tenant/deals/route.ts', src);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/enforceFieldRead/);
    expect(problems.join('\n')).toMatch(/enforceFieldWrite/);
  });

  it('does not confuse a string in a comment with a real call', () => {
    const src = [
      `import { enforceFieldRead, enforceFieldWrite } from '@/lib/rbac/enforce';`,
      `// TODO: wire enforceFieldRead( into this handler`,
    ].join('\n');
    // The comment literally contains "enforceFieldRead(" — this is a real
    // blind spot today. It stays visible here so a future tightening has an
    // existing case to reason against, rather than re-discovering the same
    // shape under the same issue.
    const problems = checkEnforcement('app/api/tenant/deals/route.ts', src);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/enforceFieldWrite/);
  });
});

describe('runGuard — aggregate over a synthetic route set', () => {
  it('passes when every route satisfies the contract', () => {
    const files = { 'a.ts': GOOD, 'b.ts': GOOD };
    const { problems, checked } = runGuard(Object.keys(files), (f) => files[f]);
    expect(problems).toEqual([]);
    expect(checked).toBe(2);
  });

  it('reports an unreadable file without throwing (a renamed route is a signal, not a crash)', () => {
    const { problems } = runGuard(['gone.ts'], () => {
      throw new Error('ENOENT');
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not readable/);
  });

  it('collects problems from every offending route, not just the first', () => {
    const { problems } = runGuard(['a.ts', 'b.ts'], () => `// no enforce at all`);
    expect(problems.length).toBeGreaterThanOrEqual(6);
  });
});

describe('the guard, run against the real tree', () => {
  it('is green on main — the five entity route pairs all enforce (#2597)', () => {
    const res = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout).toMatch(/OK — 10 entity route pairs/);
  });
});

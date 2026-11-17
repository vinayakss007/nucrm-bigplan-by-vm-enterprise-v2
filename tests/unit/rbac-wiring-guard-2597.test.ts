/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 — the "green lib, zero callers" guard.
 *
 * The original defect was invisible to `tests/unit/rbac.test.ts`: the library
 * worked, nobody used it. This spec pins both halves of the new screen — the
 * pure discovery/diff logic (including the comment-only and import-without-call
 * false positives that would otherwise make it lie) and the live exact-set
 * baseline against the real repository.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  DEFAULT_BASELINE_PATH,
  collectRbacExports,
  diffBaseline,
  findCallers,
  isCaller,
  readBaseline,
  stripComments,
} from '../../scripts/check-rbac-wiring.mjs';

const SCRIPT = join(ROOT, 'scripts', 'check-rbac-wiring.mjs');

describe('rbac wiring guard — pure discovery (#2597)', () => {
  it('finds exported functions, including generic ones, but not types or interfaces', () => {
    const sources: Record<string, string> = {
      'lib/rbac/a.ts': `
        export type A = string;
        export interface B { x: number }
        export function plain(x: number) { return x; }
        export async function generic<T extends Record<string, unknown>>(row: T) { return row; }
        function internal() {}
      `,
    };
    const exports = collectRbacExports(Object.keys(sources), (p) => sources[p]);
    expect(exports.map((e) => e.id)).toEqual([
      'lib/rbac/a.ts:generic',
      'lib/rbac/a.ts:plain',
    ]);
  });

  it('strips comments before looking for names', () => {
    const src = `// checkNeedsApproval(\n/* requestApproval( */ const x = 1;`;
    expect(stripComments(src)).not.toContain('checkNeedsApproval(');
    expect(stripComments(src)).not.toContain('requestApproval(');
  });

  it('requires both an rbac import and a call — not a mention, not an unused import', () => {
    expect(isCaller(
      `import { checkNeedsApproval } from '@/lib/rbac/approval-workflows';\ncheckNeedsApproval(ctx);`,
      'checkNeedsApproval',
    )).toBe(true);
    expect(isCaller(
      `import { checkNeedsApproval } from '@/lib/rbac/approval-workflows';\n// checkNeedsApproval(ctx);`,
      'checkNeedsApproval',
    )).toBe(false);
    expect(isCaller(
      `import { checkNeedsApproval } from '@/lib/rbac/approval-workflows';`,
      'checkNeedsApproval',
    )).toBe(false);
    expect(isCaller(
      `const checkNeedsApproval = () => 1; checkNeedsApproval();`,
      'checkNeedsApproval',
    )).toBe(false);
    expect(isCaller(
      `import { getFieldPermissions } from '../../../lib/rbac/field-permissions';\ngetFieldPermissions(ctx);`,
      'getFieldPermissions',
    )).toBe(true);
  });

  it('maps exports to their production callers', () => {
    const exports = [
      { id: 'lib/rbac/a.ts:foo', file: 'lib/rbac/a.ts', name: 'foo' },
      { id: 'lib/rbac/a.ts:bar', file: 'lib/rbac/a.ts', name: 'bar' },
    ];
    const sources = [
      { path: 'app/api/x/route.ts', source: `import { foo } from '@/lib/rbac/a';\nfoo();` },
      { path: 'tests/unit/rbac.test.ts', source: `import { bar } from '@/lib/rbac/a';\nbar();` },
    ];
    const callers = findCallers(exports, sources);
    expect(callers.get('lib/rbac/a.ts:foo')).toEqual(['app/api/x/route.ts']);
    expect(callers.get('lib/rbac/a.ts:bar')).toEqual([]);
  });

  it('fails on a new unwired export and on a stale baseline entry', () => {
    const diff = diffBaseline(
      ['lib/rbac/a.ts:known', 'lib/rbac/a.ts:new'],
      { 'lib/rbac/a.ts:known': 'old debt', 'lib/rbac/a.ts:nowWired': 'retired' },
    );
    expect(diff.added).toEqual(['lib/rbac/a.ts:new']);
    expect(diff.wired).toEqual(['lib/rbac/a.ts:nowWired']);
  });
});

describe('rbac wiring guard — the live baseline (#2597)', () => {
  it('the checked-in baseline is well formed and every entry names a real unwired export', () => {
    const baseline = readBaseline(join(ROOT, DEFAULT_BASELINE_PATH));
    const ids = Object.keys(baseline);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^lib\/rbac\/[^:]+:[A-Za-z_$][\w$]*$/);
      expect(baseline[id].length).toBeGreaterThanOrEqual(10);
    }
  });

  it('the guard exits 0 against the real repository', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(stdout).toContain('[rbac-wiring-guard] OK');
    expect(stdout).toContain('exported lib/rbac function(s)');
  });

  it('the baseline counts exactly the unwired exports on this tree', () => {
    const baseline = readBaseline(join(ROOT, DEFAULT_BASELINE_PATH));
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const match = stdout.match(/(\d+) reviewed baseline entr/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(Object.keys(baseline).length);
    // Pin the number too, so an entry cannot quietly be added to make a new
    // dead export look like reviewed debt.
    expect(Object.keys(baseline).length).toBe(13);
  });

  it('the CI guard is wired into the workflow and the census', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run guard:rbac-wiring');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['guard:rbac-wiring']).toBe('node scripts/check-rbac-wiring.mjs');
  });
});

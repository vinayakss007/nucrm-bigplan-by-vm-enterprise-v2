/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 — the screen that keeps ungated mutating routes from coming back.
 *
 * The entity-by-entity role gates are PRs; this guard is what stops the class
 * from recurring after them. Its floor is an EXACT SET, not a count, so a new
 * route cannot hide behind another one being fixed. The pure helpers and the
 * fail-closed baseline reader are tested directly; the CLI is exercised by the
 * guard's own green run in CI.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectUngated, diffBaseline, readBaseline, readSources } from '../../scripts/check-mutating-route-permissions.mjs';

const file = (path: string, source: string) => ({ path, source });

describe('collectUngated', () => {
  it('reports only mutating route files with no role gate', () => {
    const files = [
      file('a/route.ts', 'export const POST = async () => {};'),
      file('b/route.ts', 'export const PATCH = async () => {}; export const DELETE = async () => {};'),
      file('c/route.ts', 'export const GET = async () => {};'),
      file('d/route.ts', 'export const POST = async () => {}; const deny = requirePerm(ctx, "x");'),
      file('e/route.ts', 'export const PUT = async () => {}; if (!can(ctx, "x")) return;'),
      file('f/route.ts', 'export const DELETE = async () => {}; if (!ctx.isAdmin) return;'),
    ];
    expect(collectUngated(files)).toEqual(['a/route.ts', 'b/route.ts']);
  });

  it('does not mistake a mention in a comment for a gate', () => {
    // A comment can say "this needs requirePerm(ctx, …)"; the guard must still
    // fail until the code actually calls it.
    const files = [file('a/route.ts', '// requirePerm(ctx, "x")\nexport const POST = async () => {};')];
    expect(collectUngated(files)).toEqual(['a/route.ts']);
  });
});

describe('diffBaseline', () => {
  it('is quiet when the exact set matches', () => {
    expect(diffBaseline(['a/route.ts'], ['a/route.ts'])).toEqual({ added: [], fixed: [] });
  });

  it('flags a new ungated route and a stale exemption', () => {
    expect(diffBaseline(['b/route.ts'], ['a/route.ts'])).toEqual({
      added: ['b/route.ts'],
      fixed: ['a/route.ts'],
    });
  });
});

describe('readBaseline', () => {
  it('refuses a missing or malformed floor instead of reporting green', () => {
    expect(() => readBaseline('/tmp/opencode/does-not-exist-baseline.json')).toThrow(/missing/);
    const bad = join(mkdtempSync(join(tmpdir(), 'mutguard-')), 'baseline.json');
    writeFileSync(bad, '{ "count": 12 }');
    expect(() => readBaseline(bad)).toThrow(/files\[\]/);
  });
});

describe('readSources', () => {
  it('reads tracked tenant route files from an isolated repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutguard-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, 'app/api/tenant/widgets'), { recursive: true });
    const rel = 'app/api/tenant/widgets/route.ts';
    writeFileSync(join(dir, rel), 'export const POST = async () => {};');
    writeFileSync(join(dir, 'app/api/tenant/widgets/untracked.ts'), 'export const POST = async () => {};');
    execFileSync('git', ['add', '--', rel], { cwd: dir });
    const sources = readSources(dir);
    expect(sources.map((s) => s.path)).toEqual([rel]);
    expect(collectUngated(sources)).toEqual([rel]);
  });
});

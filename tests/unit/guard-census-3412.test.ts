/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3412 (PR-7D) — Guard estate census verification.
 *
 * Asserts that scripts/guard-census.mjs correctly derives the census of guard
 * aliases, detecting which are wired directly, which are run via bare script
 * paths in workflows, and which are intentionally unwired.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeCensus, ROOT } from '../../scripts/guard-census.mjs';

const SCRIPT = join(ROOT, 'scripts', 'guard-census.mjs');

describe('guard-census over the real repository (#3412)', () => {
  const census = computeCensus(ROOT);

  it('measures the complete guard estate in package.json', () => {
    expect(census.total).toBe(46);
    expect(census.wiredCount).toBe(45);
    expect(census.unwiredCount).toBe(1);
    expect(census.unwired).toEqual(['guard:migration-redecl']);
  });

  it('identifies the 3 bare script invocations in ci.yml', () => {
    const bareAliases = census.bareInvocations.map((b) => b.alias);
    expect(bareAliases).toContain('guard:audit');
    expect(bareAliases).toContain('guard:semgrep');
    expect(bareAliases).toContain('guard:env-coverage');
  });

  it('accurately attributes guards per workflow', () => {
    expect(census.perWorkflow['ci.yml']?.length).toBe(40);
    expect(census.perWorkflow['nightly-soak.yml']?.length).toBe(5);
  });

  it('CLI executes cleanly and outputs human-readable summary', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(stdout).toContain('[guard-census] Total guard aliases in package.json: 46');
    expect(stdout).toContain('[guard-census] Wired in workflows: 45/46');
    expect(stdout).toContain('[guard-census] Unwired (1): guard:migration-redecl');
  });

  it('CLI --json mode produces parseable JSON with all fields', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.total).toBe(46);
    expect(parsed.wiredCount).toBe(45);
    expect(parsed.unwired).toEqual(['guard:migration-redecl']);
    expect(Array.isArray(parsed.bareInvocations)).toBe(true);
  });
});

describe('guard-census fixture isolation (#3412)', () => {
  it('correctly categorizes wired, unwired, and bare scripts on a synthetic fixture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'census-test-'));
    try {
      const workflowsDir = join(dir, '.github', 'workflows');
      mkdirSync(workflowsDir, { recursive: true });

      const pkg = {
        scripts: {
          'guard:one': 'node scripts/check-one.mjs',
          'guard:two': 'node scripts/check-two.mjs',
          'guard:three': 'node scripts/check-three.mjs',
        },
      };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

      // Workflow 1 invokes guard:one by alias, and guard:two as bare script path
      writeFileSync(
        join(workflowsDir, 'test.yml'),
        `
name: Test
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run guard:one
      # Commented line should be ignored: npm run guard:three
      - run: node scripts/check-two.mjs
`,
      );

      const res = computeCensus(dir);
      expect(res.total).toBe(3);
      expect(res.wiredCount).toBe(2);
      expect(res.unwired).toEqual(['guard:three']);
      expect(res.bareInvocations).toHaveLength(1);
      expect(res.bareInvocations[0]?.alias).toBe('guard:two');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

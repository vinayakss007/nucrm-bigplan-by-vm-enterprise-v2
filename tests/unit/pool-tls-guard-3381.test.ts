/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeSource,
  hasTlsEntry,
  maskComments,
  poolSites,
  run,
  verifyEntry,
  MIN_POOL_SITES,
  type Finding,
} from '../../scripts/check-pool-tls-policy.mts';

// #3381: every pg.Pool in first-party source must carry the TLS policy from
// lib/db/ssl-config.ts, because `?sslmode=` in a URL does nothing for node-pg.
// Like the sibling guards this test fails open if its parser breaks, so every
// case is either a planted violation that must be named or a known-good shape
// that must not be.

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-pool-tls-policy.mts');

const find = (src: string): Finding[] => analyzeSource('planted.ts', src);

describe('the real tree (#3381)', () => {
  it('is green: no unexempt finding, no stale exemption, and the walk saw every pool', () => {
    const res = run(ROOT);
    expect(res.findings).toEqual([]);
    expect(res.stale).toEqual([]);
    expect(res.sites).toBeGreaterThanOrEqual(MIN_POOL_SITES);
  });

  it('reports findings by file, so fixing one site cannot fail another', () => {
    const res = run(ROOT);
    for (const f of res.findings) {
      expect(f.file).not.toMatch(/:\d+/);
    }
  });

  it('the CLI exits 0 on the tree it guards', () => {
    const out = spawnSync('npx', ['tsx', SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).findings).toEqual([]);
  });

  it.each([
    'scripts/db-state.ts',
    'scripts/drop-all.ts',
    'scripts/migration-runner.ts',
    'scripts/restore-db.ts',
    'scripts/seed-dev.ts',
    'scripts/seed-fresh.ts',
    'scripts/simulate-preprod-flows.ts',
    'scripts/verify-migration-chain.ts',
    'scripts/verify-tenant-isolation.ts',
    'scripts/sweep-superadmin-get.mts',
  ])('%s — every pool in the fixed file carries ssl: pgSslConfig()', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(analyzeSource(file, src)).toEqual([]);
    for (const site of poolSites(src)) expect(site.hasTls).toBe(true);
    expect(src).toContain("from '../lib/db/ssl-config'");
  });
});

describe('poolSites — the shapes the tree actually uses', () => {
  it('a literal with ssl: pgSslConfig() passes, a literal without it is a finding', () => {
    expect(find('const p = new Pool({ connectionString: u, ssl: pgSslConfig() });')).toEqual([]);
    const bad = find('const p = new Pool({ connectionString: u, max: 1 });');
    expect(bad).toHaveLength(1);
    expect(bad[0].problem).toMatch(/plaintext/);
  });

  it('the shorthand ssl and the pg.Pool namespace form are both seen', () => {
    expect(find('const p = new Pool({ connectionString: u, ssl });')).toEqual([]);
    expect(find('const p = new pg.Pool({ connectionString: u });')).toHaveLength(1);
  });

  it('a by-name PoolConfig resolves to its in-file literal — covered only if the literal has ssl', () => {
    expect(find('const cfg: PoolConfig = { ssl: pgSslConfig(), max: 1 };\nnew Pool(cfg);')).toEqual([]);
    const bare = find('const cfg = { max: 1 };\nnew Pool(cfg);');
    expect(bare).toHaveLength(1);
    expect(bare[0].problem).toMatch(/`cfg`/);
  });

  it('an unresolvable name is a finding, not a skip — #3381 ask 4', () => {
    const out = find('new Pool(makeConfig(url));');
    expect(out).toHaveLength(1);
    expect(out[0].problem).toMatch(/has no object-literal declaration/);
    expect(find('new Pool();')).toHaveLength(1);
    expect(find('new Pool();')[0].problem).toMatch(/no options object or resolvable name/);
  });

  it('a spread of an ssl variable is not credit: the decision must be visible at the pool', () => {
    expect(find('new Pool({ ...ssl, max: 1 });')).toHaveLength(1);
  });

  it('comments and strings never read as pool sites (this guard quotes itself)', () => {
    expect(find('// new Pool({ connectionString: u })\n')).toEqual([]);
    expect(find('/* new Pool({}) */\n')).toEqual([]);
    expect(find(`console.log('use new Pool({ ssl }) instead');\n`)).toEqual([]);
  });

  it('hasTlsEntry keeps its judgement to the ssl identifier, not ssl-lookalikes', () => {
    expect(hasTlsEntry('{ ssl: x }')).toBe(true);
    expect(hasTlsEntry('{ ssl }')).toBe(true);
    expect(hasTlsEntry('{ max: 1 }')).toBe(false);
    expect(hasTlsEntry('{ sslMode: "require" }')).toBe(false);
    expect(hasTlsEntry('{ pgSslConfigValue: 1 }')).toBe(false);
  });

  it('maskComments blanks content but never shifts a line number', () => {
    const src = 'line1 // new Pool({})\nline2\nline3 /* gone */\n';
    const masked = maskComments(src);
    expect(masked.split('\n')).toHaveLength(src.split('\n').length);
    expect(masked).not.toContain('new Pool');
    expect(masked).not.toContain('gone');
  });
});

describe('the baseline cannot rot', () => {
  const exemptFile = 'scripts/verify-backup.ts';
  const withFinding = [{ file: exemptFile, count: 2, problem: 'p', line: 1 }] satisfies Finding[];

  it('an exemption whose file produces no finding fails, naming the deletion', () => {
    const why = verifyEntry({ file: 'lib/db/ssl-config.ts', reason: 'x'.repeat(50) }, [], ROOT);
    expect(why).toMatch(/outlived its code/);
  });

  it('an exemption for a file that is gone fails too', () => {
    expect(verifyEntry({ file: 'scripts/gone-ok.ts', reason: 'x'.repeat(50) }, [], ROOT))
      .toMatch(/does not exist/);
  });

  it('a short reason is not an exemption', () => {
    expect(verifyEntry({ file: exemptFile, reason: 'fixing' }, withFinding, ROOT)).toMatch(/40 characters/);
  });

  it('a matching entry with a real reason excuses quietly', () => {
    // verify-backup.ts is used here as a filename that exists and can be made to
    // "carry" a planted finding; the live baseline it once was is empty since
    // #3255/#3256 landed, which is run()'s business, not this entry's shape.
    expect(verifyEntry({ file: exemptFile, reason: 'x'.repeat(50) }, withFinding, ROOT)).toBeNull();
  });

  it('an absolute or traversal path is refused', () => {
    expect(verifyEntry({ file: '/etc/passwd', reason: 'x'.repeat(50) }, [], ROOT)).toMatch(/repository-relative/);
    expect(verifyEntry({ file: '../outside.ts', reason: 'x'.repeat(50) }, [], ROOT)).toMatch(/repository-relative/);
  });
});

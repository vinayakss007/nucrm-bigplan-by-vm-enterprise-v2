/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3381 ask 2 — the screen that keeps one TLS policy at every `new Pool(`.
 *
 * `pg` has exactly one TLS channel: the `ssl` option. `?sslmode=` in the URL is libpq's
 * language, spoken by `psql`/`pg_dump`/`pg_restore` and by `pgLibpqEnv()`'s `PGSSLMODE`,
 * and node-pg reads none of it — so a pool built without `ssl` is a plaintext connection
 * wearing an encrypted-looking DSN. Most of the repo's operational pools were built that
 * way: `lib/db/ssl-config.ts` set the policy, #3256/#3382 took it to backup-verify, and
 * #3381 to the last 11 sites. What stops the twelfth is this check running in CI, because
 * a grep for `ssl:` cannot see the shorthand form, the variable form, or the `PoolConfig`
 * variable the pool is built from.
 *
 * The fixtures below plant each of those shapes deliberately: every one is a case where a
 * naive regex goes the wrong way, and the point of this file is that the screen answers
 * about the *option name*, not about a textual pattern.
 *
 * It runs from `ci.yml` as `guard:pool-tls`, folded onto the `#2528`/`#3280` step's own two
 * lines so no register coordinate below moved, and from here — where a failure can say
 * which site and why.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hasTlsEntry, poolSites } from '../../scripts/check-pool-tls-policy.mts';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-pool-tls-policy.mts');

const dir = mkdtempSync(join(tmpdir(), 'pool-tls-3381-vm-'));
let n = 0;

function fixture(files: Record<string, string>): string {
  const sub = join(dir, `case-${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    const full = join(sub, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return sub;
}

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args, root], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

/** The screen's own verdict on one source text, per site. The CLI aggregates per
 *  file, which is right for a report and wrong for a test that names the shape. */
function one(source: string) {
  const sites = poolSites(source);
  return {
    sites: sites.length,
    offenders: sites
      .filter((s) => !s.hasTls)
      .map((s) => ({
        form: s.kind,
        name: s.name,
        detail: s.problem ?? 'pool options carry no TLS entry',
      })),
  };
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the screen fails what #3381 is about', () => {
  it('fails a pool built from a bare connection string — the shape that shipped', () => {
    const r = one(`export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });\n`);
    expect(r.sites).toBe(1);
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0].detail).toContain('no TLS entry');
  });

  it('fails a pool built with no options object at all', () => {
    const r = one('const pool = new Pool();\n');
    expect(r.offenders[0].form).toBe('unresolved');
    expect(r.offenders[0].detail).toContain('no options object');
  });

  it('fails an `ssl` that is only some other key’s value', () => {
    expect(one('const pool = new Pool({ connectionString: u, defaults: ssl });\n').offenders).toHaveLength(1);
  });

  it('fails a PoolConfig variable that has no literal in this file to read', () => {
    const r = one('export function make(cfg: PoolConfig) { return new Pool(cfg); }\n');
    expect(r.offenders[0].form).toBe('unresolved');
    expect(r.offenders[0].name).toBe('cfg');
    expect(r.offenders[0].detail).toContain('no object-literal declaration in this file');
  });

  it('fails a spread, because the screen cannot see what the spread contributes', () => {
    const r = one([
      'const base = { connectionString: process.env.DATABASE_URL };',
      'const poolConfig: PoolConfig = { ...base };',
      'export const pool = new Pool(poolConfig);',
      '',
    ].join('\n'));
    expect(r.offenders).toHaveLength(1);
    // The rule is stated where it is decided: `...ssl` earns no credit, because
    // what a spread carries is a decision made somewhere else.
    expect(hasTlsEntry('{ ...ssl }')).toBe(false);
    expect(hasTlsEntry('{ ...base, ssl: pgSslConfig() }')).toBe(true);
  });

  it('names the file, not a line a later `ssl:` insert would move', () => {
    const res = run(fixture({ 'scripts/a.ts': 'const pool = new Pool({ connectionString: x });\n' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('scripts/a.ts');
  });
});

describe('the screen passes the forms a grep gets wrong', () => {
  it('takes the policy call, which is how the 28 now-converted sites read', () => {
    expect(one('const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: pgSslConfig() });\n').offenders).toHaveLength(0);
  });

  it('takes the shorthand form, where no colon follows the name', () => {
    expect(one('const ssl = { rejectUnauthorized: true };\nconst pool = new Pool({ connectionString: u, ssl });\n').offenders).toHaveLength(0);
  });

  it('takes a quoted key', () => {
    expect(one("const pool = new Pool({ 'connectionString': u, 'ssl': cfg });\n").offenders).toHaveLength(0);
  });

  it('takes an identifier that resolves to a same-file literal carrying the entry', () => {
    const r = one([
      'const poolConfig: PoolConfig = { connectionString: process.env.DATABASE_URL, ssl: pgSslConfig(), max: 1 };',
      'export const pool = new Pool(poolConfig);',
      '',
    ].join('\n'));
    expect(r.sites).toBe(1);
    expect(r.offenders).toHaveLength(0);
  });

  it('takes a nested object so the brace match does not stop early', () => {
    const r = one('const pool = new Pool({ connectionString: u, ssl: pgSslConfig(), defaults: { application_name: "nucrm" } });\n');
    expect(r.offenders).toHaveLength(0);
  });

  it('does not count a screen message that quotes `new Pool(`, in prose or in a template', () => {
    const r = one([
      '// Every `new Pool(` in this file must carry ssl.',
      'const msg = `unbalanced parentheses after new Pool(`;',
      'const other = `saw new Pool(${x}) at runtime`;',
      '',
    ].join('\n'));
    expect(r.sites).toBe(0);
    expect(r.offenders).toHaveLength(0);
  });
});

describe('the real tree arrives clean (#3381 ask 1)', () => {
  it('walks every operational pool and finds no site without a TLS entry', () => {
    const res = run(ROOT, '--json');
    expect(res.status, res.stderr.slice(0, 2000)).toBe(0);
    const out = JSON.parse(res.stdout);
    // 11 sites fixed here, backup-verify's by #3382, the rest already on the policy.
    expect(out.sites).toBeGreaterThan(25);
    expect(out.findings).toEqual([]);
    expect(out.stale).toEqual([]);
  });

  it('is the same answer the alias prints, since ci.yml runs it and not this file', () => {
    const res = run(ROOT);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/OK — \d+ Pool site\(s\) across \d+ file\(s\): every one passes/);
  });

  it('scans the root it is handed, not the tree it happens to live in', () => {
    // main() once dropped its positional root, so every fixture case was really
    // scanning the repo — the bug this assertion exists to make impossible.
    const res = run(fixture({ 'scripts/two.ts': 'const a = new Pool({ ssl: pgSslConfig() });\nconst b = new Pool({ connectionString: u });\n' }), '--json');
    const out = JSON.parse(res.stdout);
    expect(out.scanned).toBe(1);
    expect(out.sites).toBe(2);
    expect(out.findings).toHaveLength(1);
  });
});

describe('#3381 the screen walks every extension first-party source is written in', () => {
  it('fails a bare .mjs pool, the shape provision-app-role.mjs shipped', () => {
    const res = run(fixture({ 'scripts/ops.mjs': 'const pool = new Pool({ connectionString: u, max: 1 });\n' }), '--json');
    const out = JSON.parse(res.stdout);
    expect(out.sites).toBe(1);
    expect(out.findings).toHaveLength(1);
  });

  it('fails a pool in a .js or .cjs file too, so trimming the walk is caught here', () => {
    const out = JSON.parse(run(fixture({
      'scripts/a.js': 'const pool = new Pool({ connectionString: u });\n',
      'scripts/b.cjs': 'const pool = new Pool({ connectionString: u });\n',
    }), '--json').stdout);
    expect(out.sites).toBe(2);
    expect(out.findings).toHaveLength(2);
  });

  it('arms provision-app-role.mjs with the shared policy', () => {
    const src = readFileSync(join(ROOT, 'scripts/provision-app-role.mjs'), 'utf8');
    expect(src).toMatch(/ssl:\s*pgSslConfig\(\)/);
  });

  it('arms the byte-ceiling audit, the .mjs pool that walked free since #3283', () => {
    const src = readFileSync(join(ROOT, 'scripts/audit-jsonb-byte-overage.mjs'), 'utf8');
    expect(src).toMatch(/ssl:\s*pgSslConfig\(\)/);
  });
});

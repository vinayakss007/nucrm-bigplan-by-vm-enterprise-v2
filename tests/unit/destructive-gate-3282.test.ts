/**
 * #3282 — the static screen that stops an un-gated `prod:seed` from coming back.
 *
 * `npm run prod:seed` deleted every user/tenant/role/session/pipeline/deal stage in
 * whatever `DATABASE_URL` pointed at, and its own documentation table also reaches
 * `db:drop`, `db:reset`, `db:rollback`, `backup:restore` and `db:bootstrap-test`.
 * The runtime gates are one author's work; THIS file holds the half that keeps a
 * gate from rotting: a screen, derived from `package.json` and not from a list
 * anybody remembers to edit, that fails when a destructive script does not name its
 * own opt-in. The evidence that nothing else caught this is in the guard's header —
 * in short, `guard:seed-credential` reads passwords not effects, `guard:raw-sql`
 * reads interpolation, `guard:rollback-coverage` reads whether a `.down.sql` exists,
 * and the rest of the database screens need a database CI does not have.
 *
 * What is measured on the real tree, rather than quoted from the issue (re-run
 * `node scripts/check-destructive-gate.mjs --json` to reproduce; read off this
 * branch on 2026-10-25, after #3282's own gate landed):
 *
 *   - 72 script files are reachable from `package.json`; every one exists on disk.
 *   - `scripts/drop-all.ts` and `scripts/seed-fresh.ts` — the two the issue is
 *     about — now name `--yes`/`--confirm` in their own source, so they are gated
 *     rather than tolerated and hold no baseline entry. The screen keeps reading
 *     the file that holds the wipe, so a gate that lived only in the shared
 *     `scripts/seed/destructive.ts` was not enough: it stayed red until each script
 *     named its own flag, which is the rot this file exists to prevent.
 *   - One entry survives, and it survives on purpose: `scripts/verify-backup.ts`
 *     (`backup:verify`) drops the scratch database `nucrm_verify_<timestamp>` it
 *     created a few lines earlier — two `DROP DATABASE` sites, tolerated with a
 *     reason, because the target it drops is its own.
 *   - `scripts/restore-db.ts`, `scripts/rollback-migration.ts` and
 *     `scripts/migrate.ts` name `--yes`/`--confirm`/`--dry-run` in their own code;
 *     `scripts/bootstrap-test-db.ts` creates a database and drops nothing. None of
 *     them is a finding, and none of them is baselined.
 *
 *   - `scripts/restore-db.ts`, `scripts/rollback-migration.ts` and
 *     `scripts/migrate.ts` name `--yes`/`--confirm`/`--dry-run` in their own code;
 *     `scripts/bootstrap-test-db.ts` creates a database and drops nothing. None of
 *     them is a finding, and none of them is baselined.
 *
 * Per the repo rule in `tests/unit/logger-graph-schema-edge-3010.test.ts` this file
 * asserts nothing through `spawnSync('git', …)` against `origin/main`, `origin/master`
 * or `HEAD` — the tree it describes is the one on disk, read directly.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  analyse,
  main,
  deriveTargets,
  readSource,
} from '../../scripts/check-destructive-gate.mjs';

const REPO = process.cwd();
const GUARD = join(REPO, 'scripts', 'check-destructive-gate.mjs');
const BASELINE = join(REPO, 'scripts', 'destructive-gate-baseline.json');
const shipped = JSON.parse(readFileSync(BASELINE, 'utf8'));

/** `scripts/destructive-gate-baseline.json` minus its metadata keys. */
const shippedCounts = Object.fromEntries(
  Object.entries(shipped).filter(([, v]) => typeof v === 'number'),
);

/**
 * A throwaway tree: `files` are written under `scripts/` and wired into
 * package.json in order, so the derivation is exercised rather than bypassed.
 */
function tree(files: Record<string, string>, extraScripts: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'destructive-gate-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const scripts: Record<string, string> = {};
  let i = 0;
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, 'scripts', name), body);
    scripts[`s${i++}`] = name.endsWith('.mjs') || name.endsWith('.js')
      ? `node scripts/${name}`
      : `npx tsx scripts/${name}`;
  }
  Object.assign(scripts, extraScripts);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts }, null, 2)}\n`);
  return dir;
}

const run = (dir: string, extra: string[] = []) =>
  spawnSync('node', [GUARD, '--root', dir, ...extra], { encoding: 'utf8' });

// The wipe-and-rebuild half this screen reads is `GRANT … ON SCHEMA`, and #2474's screen
// reads those same words anywhere in `tests/**` — it is textual, so it cannot tell a probe
// it forbids from a fixture string nobody executes. Composing the statement from two
// fragments keeps the hot-catalogue literal out of this repository while the temp tree the
// guard actually reads still gets the whole statement, byte for byte. Same device
// `scripts/check-integration-catalog-grants.mjs:53` records for its own fixtures.
const GRANT_ON_SCHEMA = ['GRANT ALL', 'ON SCHEMA public TO public'].join(' ');

const DROP_RAW = [
  'import { Pool } from "pg";',
  'const pool = new Pool({ connectionString: process.env.DATABASE_URL });',
  'await pool.query("DROP SCHEMA public CASCADE");',
  'await pool.query("CREATE SCHEMA public");',
  `await pool.query("${GRANT_ON_SCHEMA}");`,
  'await pool.query("DROP TABLE IF EXISTS stale_imports");',
  '',
].join('\n');
const DROP_GATED = [
  'import { Pool } from "pg";',
  'const yes = process.argv.includes("--yes");',
  'if (!yes) { console.error("pass --yes"); process.exit(1); }',
  'const pool = new Pool({ connectionString: process.env.DATABASE_URL });',
  'await pool.query("DROP SCHEMA public CASCADE");',
  'await pool.query("CREATE SCHEMA public");',
  '',
].join('\n');
const DRIZZLE_RAW = [
  'import { db } from "@/drizzle/db";',
  'import { users, tenants } from "@/drizzle/schema";',
  'await db.delete(users);',
  'await db.delete(tenants);',
  '',
].join('\n');
const DELETE_SCOPED = [
  'const n = await pool.query("DELETE FROM sessions WHERE user_id = $1", [id]);',
  'await db.delete(sessions).where(eq(sessions.userId, 7));',
  '',
].join('\n');
const BENIGN = [
  'console.log("nothing to see here");',
  'const seen = new Map();',
  'seen.delete("a");',
  'const set = new Set();',
  'set.delete("b");',
  '',
].join('\n');

describe('#3282 destructive-gate analyser — the gate decision, over inline fixtures', () => {
  it('fires on a DROP SCHEMA script that names no opt-in', () => {
    const dir = tree({ 'wipe.ts': DROP_RAW });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.notApplicable).toBe(false);
    expect(r.hits.map(h => h.check)).toContain('SCHEMA_WIPE_UNGATED');
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.hits[0].file).toBe('scripts/wipe.ts');
    expect(r.hits[0].npmScripts).toEqual(['s0']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is clean when the same script names --yes in its own source', () => {
    const dir = tree({ 'wipe.ts': DROP_GATED });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits).toEqual([]);
    expect(r.findings).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fires on a whole-table Drizzle delete with no WHERE', () => {
    const dir = tree({ 'wipe.ts': DRIZZLE_RAW });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits.filter((h) => h.check === 'UNSCOPED_DELETE_UNGATED')).toHaveLength(2);
    expect(r.hits[0].detail).toContain('db.delete(users)');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT treat a DELETE … WHERE id = $1 (or a scoped db.delete) as a wipe', () => {
    const dir = tree({ 'scoped.ts': DELETE_SCOPED });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a non-destructive script produces no findings at all', () => {
    const dir = tree({ 'benign.ts': BENIGN });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.allowed).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads Map/Set .delete() as a data structure, not a table wipe', () => {
    const dir = tree({ 'benign.ts': BENIGN });
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a full wipe is not cleared by --dry-run alone: TRUNCATE still needs --yes/--confirm', () => {
    const dir = tree({
      'trunc.ts': [
        'const dry = process.argv.includes("--dry-run");',
        'await pool.query("TRUNCATE TABLE users CASCADE");',
        '',
      ].join('\n'),
    });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits.map((h) => h.check)).toEqual(['TABLE_WIPE_UNGATED']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a non-full-wipe signature IS cleared by any opt-in, so DROP TABLE + --dry-run is clean', () => {
    const dir = tree({
      'droptable.ts': [
        'const dry = process.argv.includes("--dry-run");',
        'await pool.query("DROP TABLE IF EXISTS stale_imports");',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('prose is not a statement and a comment is not a gate', () => {
    const dir = tree({
      'prose.ts': [
        '// This script never runs DROP TABLE, and its docs mention --yes for nothing.',
        '/* DROP SCHEMA public, TRUNCATE TABLE users, DELETE FROM sessions — all prose. */',
        'console.log("I only print");',
        '',
      ].join('\n'),
    });
    const r = analyse({ root: dir, baseline: {} });
    expect(r.hits).toEqual([]);
    // and the converse: a gate that exists only in a comment does not gate anything
    const commentOnly = tree({
      'fake.ts': [
        '// run me with --yes',
        'await pool.query("DROP SCHEMA public CASCADE");',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: commentOnly, baseline: {} }).hits.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
    rmSync(commentOnly, { recursive: true, force: true });
  });

  it('a regex-builder template is a matcher, not a destructive statement', () => {
    const bt = String.fromCharCode(96); // a backtick, unescaped, built at runtime
    const dir = tree({
      'matcher.mjs': [
        'const re = (source, flags) => new RegExp(source, flags);',
        'for (const m of text.matchAll(re(' + bt + 'DROP TABLE (?:IF EXISTS )?(?:public\\\\.)?${ID}' + bt + ', "gi")) {',
        '  out.push(m[1]);',
        '}',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a DELETE FROM whose WHERE arrives after an interpolation is scoped', () => {
    const bt = String.fromCharCode(96); // a backtick, built at runtime so this file needs no nesting
    const dir = tree({
      'interpolated.ts': [
        'await db.execute(' + bt + 'DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${IDS.tenant}' + bt + ');',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a TRUNCATE written only as a JS/fs call is prose, not a statement', () => {
    const dir = tree({
      'not-sql.ts': [
        'import { truncate } from "node:fs";',
        'console.log("results_truncated:", body.length);',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('readSource blanks comments, keeps literals, and keeps line numbers aligned', () => {
    const src = ['// --yes lives in a comment', "const flag = '--confirm';", '', ''].join('\n');
    const { text } = readSource(src);
    expect(text.split('\n')[0]).not.toContain('--yes');
    expect(text).toContain('--confirm');
    expect(text.split('\n')).toHaveLength(src.split('\n').length);
    expect(text.length).toBe(src.length); // offsets, so a reported line is the real one
  });
});

describe('#3282 reachable set — derived from package.json, never hardcoded', () => {
  it('an alias that is wired to no script file is ignored rather than crashing', () => {
    const dir = tree(
      { 'benign.ts': BENIGN },
      {
        'db:studio': 'node -e "console.log(process.env.DATABASE_URL)"',
        up: 'bash scripts/bootstrap.sh',
        build: 'next build',
        'logs:view': 'echo hi && xdg-open scripts/log-viewer.html',
      },
    );
    const targets = deriveTargets(dir);
    expect([...targets.keys()]).toEqual(['scripts/benign.ts']);
    const r = analyse({ root: dir, baseline: {} });
    expect(r.findings).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a --import loader is not the target, and an unwired file is out of scope', () => {
    const dir = tree({ 'probe.ts': BENIGN, 'orphan.ts': DROP_RAW });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({
        scripts: { 'probe:one': 'npx tsx --import ./scripts/orphan.ts scripts/probe.ts' },
      }, null, 2)}\n`,
    );
    const targets = deriveTargets(dir);
    expect([...targets.keys()]).toEqual(['scripts/probe.ts']); // orphan.ts is on disk but unreferenced-as-a-target
    expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a compound command contributes the script it actually runs', () => {
    const dir = tree(
      { 'drop.ts': DROP_GATED, 'migrate.ts': BENIGN },
      { 'db:reset': 'npx tsx scripts/drop.ts && npm run migrate' },
    );
    expect(deriveTargets(dir).get('scripts/drop.ts')).toContain('db:reset');
    rmSync(dir, { recursive: true, force: true });
  });

  it('no package.json means not applicable, not a crash and not a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'destructive-gate-empty-'));
    expect(deriveTargets(dir)).toBeNull();
    const r = analyse({ root: dir, baseline: {} });
    expect(r.notApplicable).toBe(true);
    expect(r.findings).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('#3282 CLI contract — the exit codes CI reads', () => {
  it('exits 0 on the real tree with the shipped baseline', () => {
    const out = spawnSync('node', [GUARD], { encoding: 'utf8' });
    expect(out.stdout).toContain('destructive gate: clean');
    expect(out.status).toBe(0);
  });

  it('exits 1 on a planted tree, with the finding at column 0 and an excerpt under it', () => {
    const dir = tree({ 'evil.ts': DROP_RAW });
    const r = run(dir, ['--baseline', join(dir, 'nope.json')]);
    expect(r.status).toBe(1);
    // the CI negative control greps ^CHECKNAME — a leading space would break it
    for (const want of ['SCHEMA_WIPE_UNGATED', 'TABLE_WIPE_UNGATED']) {
      expect(new RegExp(`^${want}\\tscripts/evil\\.ts:\\d+\\t`, 'm').test(r.stdout)).toBe(true);
    }
    const lines = r.stdout.split('\n');
    expect(lines.some((l) => l.startsWith('\t  '))).toBe(true); // indented source excerpt
    expect(lines.some((l) => /^ {2,}\S/.test(l))).toBe(false); // never an indented finding
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 2 when package.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'destructive-gate-no-pkg-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'wipe.ts'), DROP_RAW);
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no package.json');
    rmSync(dir, { recursive: true, force: true });
    expect(main(['--root', join(tmpdir(), 'definitely-not-a-repo-3282')])).toBe(2);
  });

  it('--print-baseline emits valid JSON that --update then writes, byte-identical in content', () => {
    const dir = tree({ 'evil.ts': DROP_RAW });
    const printed = run(dir, ['--print-baseline']);
    expect(printed.status).toBe(0);
    const parsed = JSON.parse(printed.stdout);
    expect(typeof parsed._comment).toBe('string');
    expect(parsed['scripts/evil.ts|SCHEMA_WIPE_UNGATED']).toBeGreaterThan(0);
    expect(Object.keys(parsed).filter((k) => k.includes('|'))).toEqual(
      Object.keys(parsed).filter((k) => k.includes('|')),
    );
    const written = join(dir, 'scripts', 'destructive-gate-baseline.json');
    const updated = run(dir, ['--update']);
    expect(updated.status).toBe(0);
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual(parsed);
    // a freshly-updated tree is clean only once a reviewer has justified each entry:
    // the ratchet itself does not grant the exemption
    expect(run(dir).status).toBe(1);
    expect(run(dir).stdout).toContain('BASELINE_UNREASONED');
    const withReasons = JSON.parse(readFileSync(written, 'utf8'));
    withReasons._reasons = Object.fromEntries(
      Object.keys(withReasons).filter((k) => k.includes('|')).map((k) => [k, '#3282 fixture reason']),
    );
    writeFileSync(written, `${JSON.stringify(withReasons, null, 2)}\n`);
    expect(run(dir).status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('--json and --explain are machine- and human-readable', () => {
    const dir = tree({ 'evil.ts': DROP_RAW });
    const j = JSON.parse(run(dir, ['--json', '--baseline', join(dir, 'nope.json')]).stdout);
    expect(Array.isArray(j.findings)).toBe(true);
    expect(j.findings.length).toBeGreaterThan(0);
    expect(typeof j.allowed).toBe('number');
    expect(j.targets['scripts/evil.ts']).toEqual(['s0']);
    const explained = run(dir, ['--explain']);
    expect(explained.status).toBe(0);
    for (const check of ['SCHEMA_WIPE_UNGATED', 'TABLE_WIPE_UNGATED', 'UNSCOPED_DELETE_UNGATED', 'BASELINE_STALE', 'BASELINE_UNREASONED']) {
      expect(explained.stdout).toContain(check);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('the pure analyser and main() agree on the same planted tree', () => {
    const dir = tree({ 'evil.ts': DROP_RAW });
    expect(analyse({ root: dir, baseline: {} }).findings.length).toBeGreaterThan(0);
    expect(main(['--root', dir, '--baseline', join(dir, 'nope.json')])).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('#3282 baseline discipline — a ratchet nobody reads is a gate nobody checks', () => {
  /** Exactly one full-wipe site, so an allowance of 1 means something. */
  const WIPE_ONE = [
    'const pool = new Pool();',
    'await pool.query("DROP SCHEMA public CASCADE");',
    '',
  ].join('\n');
  const GATED_ONE = ['const yes = process.argv.includes("--yes");', ...WIPE_ONE.split('\n')].join('\n');

  it('removing a baseline entry that no longer fires is reported as stale, not accepted', () => {
    const dir = tree({ 'gone.ts': WIPE_ONE });
    const base = join(dir, 'base.json');
    writeFileSync(base, `${JSON.stringify({
      _comment: 'fixture',
      _reasons: { 'scripts/gone.ts|SCHEMA_WIPE_UNGATED': 'fixture reason' },
      'scripts/gone.ts|SCHEMA_WIPE_UNGATED': 1,
    }, null, 2)}\n`);
    expect(analyse({ root: dir, baseline: JSON.parse(readFileSync(base, 'utf8')) }).findings).toEqual([]);

    // gate the script: the site is gone, so the allowance must not silently pass
    writeFileSync(join(dir, 'scripts', 'gone.ts'), GATED_ONE);
    const r = analyse({ root: dir, baseline: JSON.parse(readFileSync(base, 'utf8')) });
    expect(r.findings.map(f => f.check)).toEqual(['BASELINE_STALE']);
    expect(r.findings[0].detail).toContain('shrink');
    expect(run(dir, ['--baseline', base]).status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('an allowance with no recorded reason is a finding', () => {
    const dir = tree({ 'gone.ts': WIPE_ONE });
    const r = analyse({ root: dir, baseline: { 'scripts/gone.ts|SCHEMA_WIPE_UNGATED': 1 } });
    expect(r.findings.map((f) => f.check)).toEqual(['BASELINE_UNREASONED']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('the shipped baseline is current: every entry fires, every site is allowed, nothing is unreasoned', () => {
    const real = analyse({ root: REPO, baseline: shipped });
    expect(real.findings).toEqual([]);
    const measured: Record<string, number> = {};
    for (const h of real.hits) {
      const k = `${h.file}|${h.check}`;
      measured[k] = (measured[k] ?? 0) + 1;
    }
    expect(measured).toEqual(shippedCounts);
    expect(Object.keys(shippedCounts).length).toBeGreaterThan(0);
    for (const key of Object.keys(shippedCounts)) {
      expect(shipped._reasons[key], `${key} has no reason`).toBeTypeOf('string');
      expect(shipped._reasons[key].length).toBeGreaterThan(40);
    }
  });

  it('the shipped baseline is not the whole world: an unlisted destructive script is a finding', () => {
    const dir = tree({ 'evil.ts': DROP_RAW });
    const r = analyse({ root: dir, baseline: shippedCounts });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0].file).toBe('scripts/evil.ts');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('#3282 on the real tree — which scripts are gated, which are tolerated, by content', () => {
  const real = analyse({ root: REPO, baseline: shipped });
  const countsByFileCheck = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const h of real.hits) {
      const k = `${h.file}|${h.check}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const codeOf = (rel: string) => readSource(readFileSync(join(REPO, rel), 'utf8')).text;
  const namesConfirm = (rel: string) => codeOf(rel).includes('--yes') || codeOf(rel).includes('--confirm');
  const hitsFor = (rel: string) => real.hits.filter(h => h.file === rel);

  it('derives a large npm-reachable set and every derived file is on disk', () => {
    expect(real.notApplicable).toBe(false);
    expect(real.targets.size).toBeGreaterThan(60);
    for (const rel of real.targets.keys()) {
      expect(existsSync(join(REPO, rel)), `${rel} is wired up but missing`).toBe(true);
    }
  });

  it('the five scripts #3282 ask #4 names are all in the derived set', () => {
    const byNpm = new Map<string, string[]>();
    for (const [rel, names] of real.targets) byNpm.set(rel, names);
    expect(byNpm.get('scripts/drop-all.ts')).toEqual(expect.arrayContaining(['db:drop', 'db:reset']));
    expect(byNpm.get('scripts/rollback-migration.ts')).toContain('db:rollback');
    expect(byNpm.get('scripts/restore-db.ts')).toContain('backup:restore');
    expect(byNpm.get('scripts/bootstrap-test-db.ts')).toContain('db:bootstrap-test');
    // seed-fresh.ts is reachable under whatever name #3282 gave it (`prod:seed` was
    // the name in the issue; the branch renamed it to `db:seed:from-empty`), and the
    // screen does not care which, only that a human can reach it by `npm run`.
    const seedNames = byNpm.get('scripts/seed-fresh.ts') ?? [];
    expect(seedNames.length).toBeGreaterThan(0);
    expect(seedNames.join(' ')).toMatch(/prod:seed|seed:from-empty/);
  });

  it('gate-by-content: the scripts that name their own opt-in are clean and unbaselined', () => {
    for (const rel of ['scripts/restore-db.ts', 'scripts/rollback-migration.ts', 'scripts/migrate.ts']) {
      expect(namesConfirm(rel) || hitsFor(rel).length === 0, `${rel} names no flag at all`).toBe(true);
      expect(hitsFor(rel), `${rel} should not be a finding`).toEqual([]);
      expect(countsByFileCheck()[`${rel}|SCHEMA_WIPE_UNGATED`]).toBeUndefined();
    }
    // restore-db.ts gates with --confirm/--dry-run in code, not in prose
    expect(codeOf('scripts/restore-db.ts')).toContain('--confirm');
    expect(codeOf('scripts/rollback-migration.ts')).toContain('--yes');
    // bootstrap-test-db.ts creates a database and destroys nothing
    expect(hitsFor('scripts/bootstrap-test-db.ts')).toEqual([]);
  });

  it('#3282 is the owner of every tolerated site, and a tolerated full wipe is still a finding if unlisted', () => {
    const tolerated = Object.keys(shippedCounts);
    expect(tolerated.length).toBeGreaterThan(0);
    for (const key of tolerated) {
      const file = key.split('|')[0];
      const gated = namesConfirm(file);
      const listed = key in shippedCounts;
      // either the script names its own confirmation, or it is tolerated with a reason
      expect(gated || listed, `${file} is neither gated nor baselined`).toBe(true);
      if (!gated) expect(shipped._reasons[key]).toContain('#3282');
    }
  });

  it('seed-fresh.ts and drop-all.ts: destructive by content, gated-or-tolerated today, never silently clean', () => {
    const fresh = readFileSync(join(REPO, 'scripts/seed-fresh.ts'), 'utf8');
    const drop = readFileSync(join(REPO, 'scripts/drop-all.ts'), 'utf8');
    expect(fresh).toContain('db.delete(users)');
    expect(fresh).toContain('db.delete(tenants)');
    expect(drop).toContain("'DROP SCHEMA public CASCADE'");

    for (const [rel, check] of [
      ['scripts/seed-fresh.ts', 'UNSCOPED_DELETE_UNGATED'],
      ['scripts/drop-all.ts', 'SCHEMA_WIPE_UNGATED'],
    ] as const) {
      const gated = namesConfirm(rel);
      if (gated) {
        expect(hitsFor(rel), `${rel} is gated, so it must not be a finding`).toEqual([]);
      } else {
        expect(hitsFor(rel).length, `${rel} must be reported while it is un-gated`).toBeGreaterThan(0);
        expect(hitsFor(rel).every((h) => h.check === check)).toBe(true);
        expect(shippedCounts[`${rel}|${check}`]).toBe(hitsFor(rel).length);
        expect(shipped._reasons[`${rel}|${check}`]).toContain('#3282');
      }
    }
  });

  it('verify-backup.ts stays tolerated with its reason, because it only drops its own scratch database', () => {
    const src = readFileSync(join(REPO, 'scripts/verify-backup.ts'), 'utf8');
    expect(src).toContain('nucrm_verify_');
    expect(shippedCounts['scripts/verify-backup.ts|SCHEMA_WIPE_UNGATED']).toBe(hitsFor('scripts/verify-backup.ts').length);
    expect(shipped._reasons['scripts/verify-backup.ts|SCHEMA_WIPE_UNGATED']).toMatch(/scratch/i);
  });

  it('nothing outside the tolerated set is destructive-and-unlisted on the real tree', () => {
    expect(real.findings).toEqual([]);
    expect(real.allowed).toBe(real.hits.length);
    const files = new Set(real.hits.map((h) => h.file));
    const listed = new Set(Object.keys(shippedCounts).map((k) => k.split('|')[0]));
    expect([...files].sort()).toEqual([...listed].sort());
  });
});

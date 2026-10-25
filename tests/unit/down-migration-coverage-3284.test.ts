/**
 * #3284 — static guard test for `scripts/check-down-migration-coverage.mjs`.
 *
 * The rollback path was advertised (`db:rollback`, `db:rollback:coverage`) and never
 * screened: the coverage command asks whether a `.down.sql` EXISTS, and the three
 * migration guards read the forward direction only. What that let through, measured
 * rather than remembered:
 *
 *   - `0050_data_validation_checks.down.sql` deleted its CHECK constraints with a
 *     `conname LIKE 'chk_%'` loop. The loop's reach is 440 constraints belonging to
 *     seven LATER migrations — rolling back 0050 deletes them;
 *   - `0051_jsonb_safety_limits.down.sql` matched `chk_%metadata_size%`, which reaches
 *     76 of 0055's constraints, mixed `contype = 'c' AND … OR …` without parentheses so
 *     the second branch was unfiltered, and then dropped `jsonb_size_bytes`
 *     unconditionally — `2BP01 depends_on_objects`, because 0055's 179 constraints
 *     still call it;
 *   - `0055_jsonb_size_limits.down.sql` named three constraints on tables `0078` and
 *     `0080` DROP, and whose own downs recreate the relation *structure only*. The
 *     names are gone by the time 0055's rollback runs, so an unguarded drop aborts the
 *     sweep there and nothing below 0051 rolls back at all;
 *   - `0036_backup_records_checksum.sql` kept its DOWN inline, where
 *     `scripts/rollback-migration.ts` does not look, so the journal entry had no
 *     rollback file.
 *
 * This file pins all of that in both directions: the real tree is clean under the
 * checks, the ratchet is exactly as large as the defects it excuses, and a synthetic
 * tree that reintroduces each defect shape makes the guard name it. The negative
 * fixtures matter more than the positive one — a guard whose regexes quietly stop
 * matching is indistinguishable from a fixed codebase, which is the failure
 * `docs/README.md` records for the redeclaration screen.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  migrationOrder,
  buildForwardFacts,
  parseDown,
  likeToRegExp,
  unparenthesisedAndOr,
  readBaseline,
  baselineMap,
  analyse,
} from '../../scripts/check-down-migration-coverage.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const BASELINE_PATH = join(ROOT, 'scripts', 'down-migration-coverage-baseline.json');
const GUARD = join(ROOT, 'scripts', 'check-down-migration-coverage.mjs');

const down = (tag: string) => readFileSync(join(MIGRATIONS_DIR, `${tag}.down.sql`), 'utf8');

const tree = analyse({ dir: MIGRATIONS_DIR, baseline: readBaseline(BASELINE_PATH) });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A throwaway migrations dir, so a defect can be *shown* to fire, not asserted to. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'down-cov-'));
  dirs.push(root);
  const mig = join(root, 'drizzle/migrations');
  mkdirSync(join(mig, 'meta'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(mig, name), body);
  return mig;
}

const journal = (tags: string[]) =>
  JSON.stringify({
    version: '7',
    dialect: 'postgresql',
    entries: tags.map((tag, idx) => ({ idx, when: 1760000000000 + idx, tag })),
  });

const run = (args: string[]) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });

describe('#3284 — the real tree', () => {
  it('has no finding left in any check', () => {
    expect(tree.findings).toEqual([]);
    expect(tree.order.length).toBeGreaterThan(130);
  });

  it('gives every journal entry a sibling .down.sql, 0036 included', () => {
    for (const tag of tree.order) expect(tree.downs.has(tag), tag).toBe(true);
    expect(down('0036_backup_records_checksum')).toMatch(/DROP COLUMN IF EXISTS checksum\b/i);
  });

  it('scopes each down to the constraint names its own up created', () => {
    for (const tag of ['0050_data_validation_checks', '0051_jsonb_safety_limits', '0055_jsonb_size_limits']) {
      expect(down(tag), tag).toMatch(/conname\s+IN\s*\(/i);
      // the guard's own read, so a header comment naming the pattern it removed
      // cannot fail this, and a pattern that came back only as prose could not pass it
      expect(tree.downs.get(tag)!.patterns, tag).toEqual([]);
      const created = new Set(tree.facts.get(tag)!.constraints.map((c: { name: string }) => c.name));
      const named = new Set(tree.downs.get(tag)!.inList);
      for (const name of created) expect(named.has(name), `${tag}: ${name}`).toBe(true);
    }
  });

  it('counts ownership as measured, not as issue #3284 reported', () => {
    // #3284 says 85 / 186 / 101. The ups say something else, and the guard reads the ups.
    expect(tree.facts.get('0050_data_validation_checks')!.constraints.length).toBe(115);
    expect(tree.facts.get('0051_jsonb_safety_limits')!.constraints.length).toBe(20);
    expect(tree.facts.get('0055_jsonb_size_limits')!.constraints.length).toBe(179);
  });

  it('drops its shared helpers only when nothing still calls them', () => {
    const d = down('0051_jsonb_safety_limits');
    expect(d).not.toMatch(/^\s*DROP FUNCTION/m);            // every drop is conditional
    expect(d).toMatch(/classid = 'pg_constraint'/);          // the CHECK -> function edge
    expect(d).toMatch(/refclassid = 'pg_proc'/);
    expect(d).toMatch(/RAISE WARNING/);                     // and it says so when it keeps one
    expect(d).not.toMatch(/DROP FUNCTION[^%]*CASCADE/i);    // never CASCADE a guardrail away
  });

  it('parses unquoted identifiers out of a DROP CONSTRAINT (ID must not demand a closing quote)', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'ALTER TABLE widgets ADD CONSTRAINT chk_w CHECK (a > 0);\n',
      '0000_a.down.sql': 'ALTER TABLE widgets DROP CONSTRAINT IF EXISTS chk_w;\n',
    });
    const d = parseDown('0000_a', mig)!;
    expect(d.alterConstraint).toEqual([{ table: 'widgets', name: 'chk_w', ifExists: true }]);
    expect(analyse({ dir: mig, baseline: {} }).findings).toEqual([]);
  });
});

describe('#3284 — the ratchet', () => {
  it('is exactly the file, so a fix must shrink it and an addition must be declared', () => {
    expect(baselineMap(tree.owned)).toEqual(
      Object.fromEntries(Object.entries(readBaseline(BASELINE_PATH)).filter(([k]) => k !== '_comment')),
    );
    expect(Object.keys(readBaseline(BASELINE_PATH))).toContain('_comment');
    const total = Object.values(readBaseline(BASELINE_PATH) as Record<string, number>)
      .filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
    expect(total).toBe(242);
  });

  it('excuses the 242 known gaps and fails the 243rd', () => {
    const known = readBaseline(BASELINE_PATH) as Record<string, number>;
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'ALTER TABLE w ADD CONSTRAINT c1 CHECK (a);ALTER TABLE w ADD CONSTRAINT c2 CHECK (b);\n',
      '0000_a.down.sql': 'SELECT 1;\n',
    });
    expect(analyse({ dir: mig, baseline: { '0000_a': 2 } }).findings).toEqual([]);
    const one = analyse({ dir: mig, baseline: { '0000_a': 1 } }).findings;
    expect(one.map((f: { check: string }) => f.check)).toEqual(['NOT_OWNED']);
    expect(known['0002_flat_sir_ram']).toBe(136); // a `SELECT 1;` stub, not a repaired rollback
  });

  it('reports slack rather than silently widening', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'ALTER TABLE w ADD CONSTRAINT c1 CHECK (a);ALTER TABLE w ADD CONSTRAINT c2 CHECK (b);\n',
      '0000_a.down.sql': 'ALTER TABLE w DROP CONSTRAINT c1;\n',
    });
    expect(analyse({ dir: mig, baseline: { '0000_a': 3 } }).baselineSlack).toEqual(['0000_a: 3 -> 1']);
  });
});

describe('#3284 — each defect shape makes the guard name it', () => {
  it('NO_ROLLBACK: a journal entry with no down file', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (id int);\n',
      '0000_a.down.sql': 'DROP TABLE t;\n',
      '0001_b.sql': 'CREATE TABLE u (id int);\n',
    });
    expect(checks(mig)).toEqual(['NO_ROLLBACK']);
  });

  it('DEAD_RELATION: a constraint drop on a relation a later up dropped for good', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE gadgets (id int);\n',
      '0000_a.down.sql': 'ALTER TABLE gadgets DROP CONSTRAINT IF EXISTS gadgets_self_fk;\n',
      '0001_b.sql': 'DROP TABLE gadgets;\n',
      '0001_b.down.sql': 'SELECT 1;\n',
    });
    expect(checks(mig)).toContain('DEAD_RELATION');
  });

  it('DEAD_CONSTRAINT: the later down recreates the relation structure only', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (meta jsonb);\nALTER TABLE t ADD CONSTRAINT chk_t_size CHECK (f(meta) < 1);\n',
      '0000_a.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_t_size;\n',
      '0001_b.sql': 'DROP TABLE t;\n',
      '0001_b.down.sql': 'CREATE TABLE t (meta jsonb);\n',
    });
    expect(checks(mig)).toContain('DEAD_CONSTRAINT');
  });

  it('FOREIGN_OBJECT: a LIKE loop is measured by its reach, not its comment', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (meta jsonb);\nALTER TABLE t ADD CONSTRAINT chk_own CHECK (f(meta) < 1);\n',
      '0000_a.down.sql': "DELETE FROM pg_constraint WHERE conname LIKE 'chk_%';\n",
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT chk_late CHECK (f(meta) < 2);\n',
      '0001_b.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_late;\n',
    });
    const found = analyse({ dir: mig, baseline: {} }).findings.filter((f: { check: string }) => f.check === 'FOREIGN_OBJECT');
    expect(found.length).toBe(1);
    expect(found[0].detail).toMatch(/reaches 1 constraint\(s\) created by LATER migrations \(1 from 0001_b\)/);
  });

  it('FOREIGN_OBJECT: an IN list is read name by name', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (a int);\n',
      '0000_a.down.sql': "DELETE FROM pg_constraint WHERE conname IN ('chk_late', 'chk_other');\n",
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT chk_late CHECK (a > 0);\n',
      '0001_b.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_late;\n',
    });
    expect(checks(mig)).toContain('FOREIGN_OBJECT');
  });

  it('HELPER_HELD: a function drop while a later CHECK still calls it', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (meta jsonb);\nALTER TABLE t ADD CONSTRAINT chk_own CHECK (f(meta) < 1);\n',
      '0000_a.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_own;\nDROP FUNCTION f(jsonb);\n',
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT chk_late CHECK (f(meta) < 2);\n',
      '0001_b.down.sql': 'SELECT 1;\n',
    });
    expect(checks(mig)).toContain('HELPER_HELD');
  });

  it('HELPER_HELD: naming the constraints is not enough if that down cannot run', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b', '0002_c']),
      '0000_a.sql': 'CREATE TABLE t (meta jsonb);\nALTER TABLE t ADD CONSTRAINT chk_own CHECK (f(meta) < 1);\n',
      '0000_a.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_own;\nDROP FUNCTION f(jsonb);\n',
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT chk_late CHECK (f(meta) < 2);\n',
      '0001_b.down.sql': 'ALTER TABLE t DROP CONSTRAINT chk_late;\n',
      '0002_c.sql': 'DROP TABLE t;\n',
      '0002_c.down.sql': 'SELECT 1;\n',
    });
    expect(checks(mig)).toContain('HELPER_HELD');
  });

  it('OPERATOR_PRECEDENCE: AND binds tighter than OR, and the loop is wider than it reads', () => {
    expect(unparenthesisedAndOr("WHERE contype = 'c' AND conname LIKE 'a' OR conname LIKE 'b'")).toBe(true);
    expect(unparenthesisedAndOr("WHERE contype = 'c' AND (conname LIKE 'a' OR conname LIKE 'b')")).toBe(false);
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'CREATE TABLE t (a int);\n',
      '0000_a.down.sql': "DELETE FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'x_%' OR conname LIKE 'y_%';\n",
    });
    expect(checks(mig)).toContain('OPERATOR_PRECEDENCE');
  });

  it('credits the honest routes: name, IN list, LIKE, DROP TABLE, DROP COLUMN', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b', '0002_c', '0003_d', '0004_e']),
      '0000_a.sql': 'CREATE TABLE t (a int, b int);\nALTER TABLE t ADD CONSTRAINT c0 CHECK (a > 0);\n',
      '0000_a.down.sql': 'ALTER TABLE t DROP CONSTRAINT c0;\n',
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT c1 CHECK (a > 1);\n',
      '0001_b.down.sql': "DELETE FROM pg_constraint WHERE conname IN ('c1');\n",
      '0002_c.sql': 'ALTER TABLE t ADD CONSTRAINT c2 CHECK (a > 2);\n',
      '0002_c.down.sql': "DELETE FROM pg_constraint WHERE conname LIKE 'c2';\n",
      '0003_d.sql': 'ALTER TABLE t ADD CONSTRAINT c3 CHECK (a > 3);\n',
      '0003_d.down.sql': 'DROP TABLE t;\n',
      '0004_e.sql': 'ALTER TABLE t ADD CONSTRAINT c4 CHECK (b > 4);\n',
      '0004_e.down.sql': 'ALTER TABLE t DROP COLUMN b;\n',
    });
    expect(analyse({ dir: mig, baseline: {} }).findings).toEqual([]);
  });

  it('does not read a pattern out of a prose comment', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (a int);\n',
      '0000_a.down.sql': "-- this script deliberately avoids conname LIKE 'chk_%'\nDROP TABLE IF EXISTS t;\n",
      '0001_b.sql': 'CREATE TABLE t2 (a int);\n',
      '0001_b.down.sql': 'DROP TABLE t2;\n',
    });
    expect(analyse({ dir: mig, baseline: {} }).findings).toEqual([]);
  });

  it('honours a relation whose absence the script tests first', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE gadgets (id int);\n',
      '0000_a.down.sql':
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'gadgets') THEN\n"
        + 'EXECUTE $q$ALTER TABLE gadgets DROP CONSTRAINT IF EXISTS gadgets_fk$q$; END IF; END $$;\n',
      '0001_b.sql': 'DROP TABLE gadgets;\n',
      '0001_b.down.sql': 'SELECT 1;\n',
    });
    expect(checks(mig)).not.toContain('DEAD_RELATION');
  });

  it('likeToRegExp is SQL LIKE, not a glob with the metacharacters left in', () => {
    expect(likeToRegExp('chk_%').test('chk_anything')).toBe(true);
    expect(likeToRegExp('chk_%').test('not_chk_x')).toBe(false);
    expect(likeToRegExp('chk_%metadata_size%').test('chk_t_metadata_size')).toBe(true);
    expect(likeToRegExp('chk_a_b').test('chk_a_b')).toBe(true);
    expect(likeToRegExp('chk_a_b').test('chk_axb')).toBe(true);  // `_` is SQL's any-one-char
    expect(likeToRegExp('a.b%').test('aXb')).toBe(false);
    expect(likeToRegExp('a.b%').test('a.b')).toBe(true);
  });

  it('walks the journal in apply order, which is reverse rollback order', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0002_c', '0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (a int);\n', '0000_a.down.sql': 'SELECT 1;\n',
      '0001_b.sql': 'CREATE TABLE u (a int);\n', '0001_b.down.sql': 'SELECT 1;\n',
      '0002_c.sql': 'CREATE TABLE v (a int);\n', '0002_c.down.sql': 'SELECT 1;\n',
    });
    expect(migrationOrder(mig)).toEqual(['0002_c', '0000_a', '0001_b']);
    expect(buildForwardFacts(['0002_c'], mig).get('0002_c')!.tables).toEqual(['v']);
  });
});

describe('#3284 — the CLI contract CI depends on', () => {
  it('exits 0 on the tree this branch ships', () => {
    const r = run([]);
    expect(r.stdout).toMatch(/^down-migration coverage: clean across \d+ migrations$/m);
    expect(r.status).toBe(0);
  });

  it('exits 1 naming every finding', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a', '0001_b']),
      '0000_a.sql': 'CREATE TABLE t (meta jsonb);\nALTER TABLE t ADD CONSTRAINT chk_own CHECK (f(meta) < 1);\n',
      '0000_a.down.sql': "DELETE FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'chk_%' OR conname LIKE 'x%';\nDROP FUNCTION f(jsonb);\n",
      '0001_b.sql': 'ALTER TABLE t ADD CONSTRAINT chk_late CHECK (f(meta) < 2);\n',
      '0001_b.down.sql': 'SELECT 1;\n',
    });
    const r = run(['--migrations-dir', mig, '--baseline', join(mig, 'none.json')]);
    expect(r.status).toBe(1);
    for (const want of ['FOREIGN_OBJECT', 'HELPER_HELD', 'OPERATOR_PRECEDENCE', 'NOT_OWNED']) {
      expect(r.stdout, want).toContain(want);
    }
    expect(r.stdout).toMatch(/^\d+ rollback defect\(s\) found/m);
  });

  it('exits 2 rather than passing an unreadable tree', () => {
    const r = run(['--migrations-dir', join(tmpdir(), 'no-such-tree')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no _journal\.json/);
  });

  it('--print-baseline emits the map a clean tree would need', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'CREATE TABLE t (a int);\nALTER TABLE t ADD CONSTRAINT c1 CHECK (a > 0);\n',
      '0000_a.down.sql': 'SELECT 1;\n',
    });
    const r = run(['--migrations-dir', mig, '--baseline', join(mig, 'none.json'), '--print-baseline']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ '0000_a': 1 });
  });

  it('--update writes the ratchet, and the guard then fails only on a new gap', () => {
    const mig = fixture({
      'meta/_journal.json': journal(['0000_a']),
      '0000_a.sql': 'CREATE TABLE t (a int);\nALTER TABLE t ADD CONSTRAINT c1 CHECK (a > 0);\n',
      '0000_a.down.sql': 'SELECT 1;\n',
    });
    const bl = join(mig, '..', 'baseline.json');
    expect(run(['--migrations-dir', mig, '--baseline', bl]).status).toBe(1);
    expect(run(['--migrations-dir', mig, '--baseline', bl, '--update']).status).toBe(0);
    expect((JSON.parse(readFileSync(bl, 'utf8')) as Record<string, number>)['0000_a']).toBe(1);
    writeFileSync(join(mig, '0000_a.sql'), sql0000b());
    expect(run(['--migrations-dir', mig, '--baseline', bl]).status).toBe(1);
    rmSync(bl, { force: true });
  });
});

function sql0000b() {
  return 'CREATE TABLE t (a int);\nALTER TABLE t ADD CONSTRAINT c1 CHECK (a > 0);\nALTER TABLE t ADD CONSTRAINT c2 CHECK (a < 9);\n';
}

/** The check names a synthetic tree trips, de-duplicated and sorted for stable asserts. */
function checks(mig: string): string[] {
  return [...new Set(analyse({ dir: mig, baseline: {} }).findings.map((f: { check: string }) => f.check))].sort();
}

describe('#3284 the rollback-coverage job is wired into CI', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const jobStart = ci.indexOf('\n  rollback-coverage:');
  const job = jobStart === -1 ? '' : ci.slice(jobStart, ci.indexOf('\n  constraint-vocab:'));

  it('is declared, with a readable name and an opt-out variable', () => {
    expect(jobStart, 'ci.yml must declare a rollback-coverage job').toBeGreaterThan(-1);
    expect(job).toContain('name: Down-migration coverage (#3284)');
    expect(job).toContain("if: vars.ROLLBACK_COVERAGE_GUARD_ENABLED != 'false'");
  });

  it('sits below the last cited coordinate without displacing #3241 as the last job', () => {
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    expect(jobKeys.indexOf('rollback-coverage')).toBeLessThan(jobKeys.length - 1);
    expect(ci.slice(0, jobStart).split('\n').length).toBeGreaterThan(447);
    // ci.yml:1-447 must be byte-identical to the branch this issue was written
    // against, because `:221`, `:254`, `:401` and `:447` are register pointers.
    const { status } = spawnSync('git', ['diff', '--numstat', 'HEAD', '--', '.github/workflows/ci.yml'], { cwd: ROOT, encoding: 'utf8' });
    expect(status).toBe(0);
  });

  it('runs the package.json alias in both steps, not a hand-copied command', () => {
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['guard:rollback-coverage'])
      .toContain('scripts/check-down-migration-coverage.mjs');
    for (const step of ['Positive control', 'Negative control']) {
      expect(job.slice(job.indexOf(step)), step).toContain('npm run guard:rollback-coverage');
    }
  });

  it('demands a FAILURE from the negative control, and the right reason', () => {
    expect(job).toMatch(/if \[ "\$\{PIPESTATUS\[0\]}" -eq 0 \]; then/);
    expect(job).toContain('#3284 the guard PASSED a rollback');
    // the reasons are required by name, and a pass is a failure
    expect(job).toContain('for want in FOREIGN_OBJECT DEAD_RELATION HELPER_HELD; do');
    expect(job).toContain('grep -q "^$want"');
  });

  it('is the first guard step in the local pre-merge screen, and says why', () => {
    const pre = readFileSync(join(ROOT, 'scripts/pre-merge-check.sh'), 'utf8');
    expect(pre).toContain('npm run guard:rollback-coverage');
    expect(pre).toContain('guard:migration-redecl has no step in pre-merge-check.sh');
    expect([...pre.matchAll(/▶ (\d+)\/5/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5]);
  });
});

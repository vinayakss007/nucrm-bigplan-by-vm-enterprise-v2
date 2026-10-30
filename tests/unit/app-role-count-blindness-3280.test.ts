/**
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  declaredTables,
  readOpenTables,
  rlsFilteredTables,
} from '../../scripts/lib/rls-filtered-tables.mjs';
import { main, reconcile, scan } from '../../scripts/check-app-role-counts.mjs';

const ROOT = join(__dirname, '..', '..');
const FIX = join(ROOT, 'tests/fixtures/app-role-counts-3280');
const SCRIPT = join(ROOT, 'scripts/check-app-role-counts.mjs');
const DECLARED = declaredTables(join(ROOT, 'drizzle/schema'));
const OPEN = readOpenTables(join(ROOT, 'drizzle/migrations'));
const FILTERED = rlsFilteredTables({
  schemaDir: join(ROOT, 'drizzle/schema'),
  migrationsDir: join(ROOT, 'drizzle/migrations'),
});

const cli = (args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
const withSet = (name: string) => scan({ root: join(FIX, name), tables: FILTERED });
const files = (rows: { violations: { file: string }[] }) => rows.violations.map((v) => v.file).sort();

describe('#3280 the denominator is the schema, not a list someone keeps', () => {
  it('is every declared table except the ones an open SELECT policy exempts', () => {
    expect(FILTERED).toEqual(DECLARED.filter((t: string) => !OPEN.includes(t)));
    expect(FILTERED.length).toBe(DECLARED.length - OPEN.length);
    expect(FILTERED).toEqual([...FILTERED].sort());
  });

  it('names the tables whose counts were quoted as absence', () => {
    for (const t of ['users', 'contacts', 'deal_stages', 'sessions', 'invoice_line_items']) {
      expect(FILTERED, t).toContain(t);
    }
  });

  it('exempts the tables a USING (true) SELECT policy opens', () => {
    for (const t of ['tenants', 'plans', 'ai_providers', 'backup_records']) {
      expect(OPEN, t).toContain(t);
      expect(FILTERED, t).not.toContain(t);
    }
    expect(withSet('read-open').violations).toEqual([]);
  });

  it('re-reads a table whose open policy was later dropped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'approle-open-vm-'));
    try {
      writeFileSync(join(dir, '0054_a.sql'),
        'CREATE POLICY widgets_read_all ON widgets FOR SELECT USING (true);\n');
      expect(readOpenTables(dir)).toEqual(['widgets']);
      writeFileSync(join(dir, '0088_b.sql'),
        'DROP POLICY IF EXISTS "widgets_read_all" ON "widgets";\n');
      expect(readOpenTables(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the journal in order, forward files only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'approle-journal-vm-'));
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'sub', '0002_b.sql'),
        'CREATE POLICY gadgets_read_all ON gadgets FOR SELECT USING (true);\n');
      writeFileSync(join(dir, 'sub', '0001_a.sql'),
        'CREATE POLICY things_read_all ON things FOR SELECT USING (true);\n');
      writeFileSync(join(dir, 'sub', '0001_a.down.sql'),
        'DROP POLICY IF EXISTS things_read_all ON things;\n');
      expect(readOpenTables(join(dir, 'sub'))).toEqual(['gadgets', 'things']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to invent a denominator out of a missing directory', () => {
    expect(() => readOpenTables(join(ROOT, 'drizzle/nope'))).toThrow(/no such directory/);
    expect(() => declaredTables(join(ROOT, 'drizzle/nope'))).toThrow(/no such directory/);
  });
});

describe('#3280 the rule, on fixtures', () => {
  it('names both ways a script can read a filtered table', () => {
    const found = withSet('blind').violations.sort((a, b) => a.file.localeCompare(b.file));
    expect(found.map((v) => v.file)).toEqual(['scripts/counts.ts', 'scripts/pick.ts']);
    expect(found[0]?.tables).toEqual(['users']);
    expect(found[1]?.tables).toEqual(['deal_stages']);
  });

  it('accepts an armed session however it was armed', () => {
    expect(withSet('armed').violations).toEqual([]);
  });

  it('honours the escape hatch, and only for the file that claims it', () => {
    expect(withSet('allowed').violations).toEqual([]);
    expect(files(withSet('blind'))).toHaveLength(2);
  });

  it('walks scripts/ only — app and lib are guard:rls territory', () => {
    const result = scan();
    expect(result.violations.every((v) => v.file.startsWith('scripts/'))).toBe(true);
    expect(result.scanned).toBeGreaterThan(100);
  });

  it('treats a session armed through the readonly helper as armed', () => {
    expect(scan().violations).toEqual([]);
    expect(readFileSync(join(ROOT, 'scripts/triage-errors.mts'), 'utf8'))
      .toContain('withReadonlySession(');
  });
});

describe('#3280 the real tree', () => {
  it('passes, with nothing tolerated', () => {
    const run = cli([]);
    expect(run.stdout, run.stderr).toContain('OK —');
    expect(run.stdout).toContain(`${FILTERED.length} RLS-filtered tables`);
    expect(run.stdout).toContain('0 un-armed reads, 0 tolerated');
    expect(run.status).toBe(0);
  });

  it('reports its shape as JSON', () => {
    const out = JSON.parse(cli(['--json']).stdout);
    expect(out).toEqual({
      rlsFilteredTables: FILTERED.length,
      scanned: expect.any(Number),
      findings: [],
      problems: [],
      tolerated: 0,
    });
  });

  it('refuses to run rather than guess a baseline path', () => {
    const run = cli(['--baseline']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--baseline needs a path');
  });

  it('is a gate, not a report: a new blind script fails it, an armed one does not', () => {
    const root = mkdtempSync(join(tmpdir(), 'approle-tree-vm-'));
    mkdirSync(join(root, 'drizzle/migrations'), { recursive: true });
    mkdirSync(join(root, 'drizzle/schema'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'drizzle/schema/core.ts'),
      `export const users = pgTable('users', { id: serial('id').primary() });\n`);
    try {
      writeFileSync(join(root, 'scripts/blind.ts'), "export const q = 'select count(*) from users';\n");
      const run = cli([root]);
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain('scripts/blind.ts: users');
      expect(run.stderr).toContain('npm run db:count');
      writeFileSync(join(root, 'scripts/blind.ts'), [
        "import { withSecurityContext } from '@/lib/db/rls';",
        'export const f = () => withSecurityContext((tx) => tx.select().from(users));',
      ].join('\n'));
      expect(cli([root]).status).toBe(0);
      writeFileSync(join(root, 'scripts/blind.ts'),
        "export const q = 'select count(*) from users'; // app-role-counts: allow — measures the gap\n");
      expect(cli([root]).status).toBe(0);
      writeFileSync(join(root, 'drizzle/schema/core.ts'), [
        `export const users = pgTable('users', { id: serial('id').primary() });`,
        `export const plans = pgTable('plans', { id: serial('id').primary() });`,
      ].join('\n'));
      writeFileSync(join(root, 'drizzle/migrations/0002_open.sql'),
        'CREATE POLICY plans_read_all ON plans FOR SELECT USING (true);\n');
      writeFileSync(join(root, 'scripts/blind.ts'), "export const q = 'select count(*) from plans';\n");
      expect(cli([root]).status, cli([root]).stderr).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('#3280 the baseline is shrink-only', () => {
  const violations = [{ file: 'scripts/counts.ts', tables: ['users'] }];
  const blind = join(FIX, 'blind');
  const entry = (over = {}) =>
    ({ file: 'scripts/counts.ts', tables: 'users', reason: 'a probe of the blindness itself', ...over });

  it('tolerates what it names, and only that', () => {
    expect(reconcile([entry()], violations, blind)).toEqual([]);
    expect(reconcile([entry({ tables: '' })], violations, blind)).toEqual([
      { code: 'BASELINE_INCOMPLETE', file: 'scripts/counts.ts', tables: ['users'] },
    ]);
  });

  it('fails when the tolerance is no longer buying anything', () => {
    expect(reconcile([entry()], [], blind)).toEqual([
      { code: 'BASELINE_STALE', file: 'scripts/counts.ts' },
    ]);
    expect(reconcile([entry()], violations, join(FIX, 'no-such-tree'))).toEqual([
      { code: 'BASELINE_MISSING_FILE', file: 'scripts/counts.ts' },
    ]);
  });

  it('demands a reason and one entry per file', () => {
    expect(reconcile([entry({ reason: 'too short' })], violations, blind))
      .toContainEqual({ code: 'BASELINE_NO_REASON', file: 'scripts/counts.ts' });
    expect(reconcile([entry(), entry()], violations, blind))
      .toContainEqual({ code: 'BASELINE_DUPLICATE', file: 'scripts/counts.ts' });
  });

  it('is empty on the real tree, and the real tree is what keeps it empty', () => {
    expect(JSON.parse(readFileSync(join(ROOT, 'scripts/app-role-counts-baseline.json'), 'utf8')).exempt).toEqual([]);
    expect(main([])).toBe(0);
  });
});

describe('#3280 the scripts that were blind keep their arms on', () => {
  const script = (f: string) => readFileSync(join(ROOT, 'scripts', f), 'utf8');

  it('tells the operator when bootstrap.sh cannot read the count at all', () => {
    const sh = script('bootstrap.sh');
    expect(sh).toContain("PGOPTIONS='-c app.is_super_admin=true'");
    expect(sh).not.toContain('|| echo "0"');
    expect(sh).toMatch(/if ! admin_count=\$\(PGPASSWORD/);
    expect(sh).toContain('Super-admin count unreadable — not the same as zero');
  });

  it('counts drift-check drop candidates where the rows are visible', () => {
    const ts = script('drift-check.ts');
    expect(ts).toContain(`SELECT set_config('app.is_super_admin', 'true', true)`);
    expect(ts).toContain('SET TRANSACTION READ ONLY');
    expect(ts.indexOf('set_config')).toBeLessThan(ts.indexOf('count(*) as rows from public'));
  });

  it('labels the restored user count with the context that produced it', () => {
    for (const f of ['restore-db.ts', 'verify-backup.ts']) {
      const ts = script(f);
      expect(ts, f).toContain('BEGIN READ ONLY');
      expect(ts, f).toContain(`SELECT set_config('app.is_super_admin', 'true', true)`);
      expect(ts, f).toContain('counted with app.is_super_admin=true');
    }
  });

  it('arms the jsonb audit inside one read-only transaction', () => {
    expect(script('audit-jsonb-byte-overage.mjs')).toContain(`set_config('app.is_super_admin', 'true', true)`);
    expect(script('audit-jsonb-byte-overage.mjs')).toContain('BEGIN READ ONLY');
  });

  it('shows diagnose-production the gap, in that order', () => {
    const ts = script('diagnose-production.ts');
    expect(ts.indexOf('blindUserRows')).toBeLessThan(ts.indexOf(`set_config('app.is_super_admin'`));
    expect(ts).toContain('unarmed count is not evidence of');
  });

  it('arms the two seed scripts that used to conclude the fixture did not exist', () => {
    for (const f of ['seed-api-data.ts', 'seed-e2e-user.ts']) {
      const ts = script(f);
      expect(ts, f).toContain('withSecurityContext');
      expect(ts, f).toContain('#3280');
    }
    expect(script('seed-e2e-user.ts')).toMatch(/ensureUserAndTenant\(tx: RlsTransaction\)/);
  });
});

describe('#3280 db:count is the loud helper', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/db-count.mts'), ...args],
      { cwd: ROOT, encoding: 'utf8' });

  it('refuses a table name that is not one identifier, before it connects', () => {
    const res = run(['users; DROP TABLE users']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('refusing unexpected identifier');
  });

  it('takes exactly one table', () => {
    expect(run([]).stderr).toContain('exactly one table name is required');
    expect(run(['users', 'tenants']).stderr).toContain('exactly one table name is required');
  });

  it('will not put an unvalidated uuid into the GUC', () => {
    const res = run(['--tenant', "x'; select 1", 'users']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--tenant must be a uuid');
  });

  it('documents itself', () => {
    expect(run(['--help']).stdout).toContain('Usage: npm run db:count -- [options] <table>');
  });

  it('is wired as an alias that loads the environment', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:count']).toContain('scripts/db-count.mts');
    expect(pkg.scripts['db:count']).toContain('./scripts/load-env.mjs');
    expect(pkg.scripts['guard:app-role-counts']).toBe('node scripts/check-app-role-counts.mjs');
  });

  it('asks the live catalog, not a hand-kept list, what the table allows', () => {
    const ts = readFileSync(join(ROOT, 'scripts/db-count.mts'), 'utf8');
    expect(ts).toContain('relforcerowsecurity');
    expect(ts).toContain('relrowsecurity');
    expect(ts).toContain('pg_policies');
  });
});

describe('#3280 the screen is wired and the census says so', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const lines = ci.split('\n');

  it('runs in CI by alias, on the step that already reads raw SQL', () => {
    expect(ci).toContain('npm run guard:raw-sql && npm run guard:app-role-counts');
    expect(ci).toMatch(/- name: Raw-SQL \+ un-armed RLS read.*#2528, #3280/);
  });

  it('sits at the line the preprod register cites, so no coordinate moves', () => {
    expect(lines.findIndex((l) => l.includes('npm run guard:raw-sql')) + 1).toBe(87);
    expect(lines.findIndex((l) => l.includes('npm run guard:rls')) + 1).toBe(45);
  });

  it('is counted by the docs census, which is a check rather than prose', () => {
    const readme = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
    const para = /enforces \*\*(\d+)\*\*[^—]*—([\s\S]*?)—\s*plus/.exec(readme);
    expect(para).not.toBeNull();
    const named = [...para![2].matchAll(/`(guard:[a-z-]+)`/g)].map((m) => m[1]);
    expect(named).toContain('guard:app-role-counts');
    expect(Number(para![1])).toBe(named.length);
    const invoked = new Set([...ci.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
      .matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]));
    for (const alias of named) expect(invoked.has(alias), `${alias} claimed but not invoked`).toBe(true);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const total = Object.keys(pkg.scripts).filter((k) => k.startsWith('guard:'));
    // The paragraph's own arithmetic: named + bare + nightly-soak + the exempt one it
    // names is the whole set. Deriving it beats assuming total = named + 1, which was
    // false before #3280 and is false after it.
    const bare = Number(/plus \*\*(\d+)\*\* run as bare commands/.exec(readme)?.[1]);
    const soak = Number(/\*\*(\d+)\*\* more by alias in `nightly-soak.yml`/.exec(readme)?.[1]);
    const exempt = Number(/so exactly \*\*(\d+)\*\* — `guard:[a-z-]+` — has no workflow step/.exec(readme)?.[1]);
    expect([bare, soak, exempt]).toEqual([3, 3, 1]);
    expect(total.length).toBe(named.length + bare + soak + exempt);
    expect(readme).toMatch(new RegExp(`defines \\*\\*${total.length}\\*\\* aliases in total`));
  });

  it('is written down where an operator will look for it', () => {
    const banner = readFileSync(join(ROOT, 'docs/database-security.md'), 'utf8').slice(0, 1800);
    expect(banner).toContain('A count is not a census until you say who counted');
    expect(banner).toContain('npm run db:count');
    expect(banner).toContain(`the other ${FILTERED.length}`);
    expect(banner).toContain(`${OPEN.length} of them carry`);
    // Ask 1 is a proposal the repo does not apply, and the doc has to say so: a
    // BYPASSRLS role is exactly what the startup check refuses for the app.
    const whole = readFileSync(join(ROOT, 'docs/database-security.md'), 'utf8');
    expect(whole).toContain('### The read-only ops role (#3280 ask 1) — proposed, not provisioned here');
    expect(whole).toContain('CREATE ROLE nucrm_ops LOGIN PASSWORD');
    expect(whole).toContain('NEVER put this in the app');
    const ops = readFileSync(join(ROOT, 'docs/BASECRM/07-OPS-NOTES.md'), 'utf8');
    expect(ops).toContain('## Row counts as the application role (#3280)');
    expect(ops).toContain("PGOPTIONS='-c app.is_super_admin=true'");
    expect(ops).toContain(`${DECLARED.length} tables the schema declares`);
    const goLive = readFileSync(join(ROOT, 'docs/runbooks/go-live.md'), 'utf8');
    expect(goLive).toContain('Say who counted, on every number in that block');
    expect(goLive).toContain('so only `tenants` reads honestly');
  });
});

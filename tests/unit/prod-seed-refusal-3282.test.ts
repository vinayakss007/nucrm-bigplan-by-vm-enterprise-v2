/**
 * #3282 — `npm run prod:seed` was a loaded gun with a good label.
 *
 * Measured against the commit the issue was written on, `scripts/seed-fresh.ts` was 117 lines
 * that did three things with nothing in between: count `users`, and if the count was non-zero
 * DELETE `sessions`, `tenantMembers`, `dealStages`, `pipelines`, `roles`, `users` and `tenants`;
 * then hash the committed literal `'Admin123!'` into `admin@nucrm.com` with `is_super_admin = true`
 * and mint it a 30-day session. No `NODE_ENV` check, no host check, no confirmation, no
 * `--dry-run`, no warning — unlike `seed-dev.ts`, which at least had two guards (both of which
 * #3281 proved were the wrong signals). The name is the only reason anyone would expect it to be
 * safe, and `AGENTS.md` listed it among the routine database commands.
 *
 * Two things made it worse than a bad password. `isSuperAdmin` closes the one-shot
 * `app/api/setup/create-admin/route.ts:45` window permanently, so the operator's own admin can
 * never be created afterwards; and `hashPassword('Admin123!')` satisfies
 * `lib/auth/session.ts:38-46`, so the published credential is immediately usable rather than
 * rejected by the app — which is the opposite of #3281's `password123`, a literal that could only
 * ever be written directly to the table.
 *
 * And the gate the issue's own first draft proposed (`if (existingUsers.count > 0) refuse`) is
 * worse than no gate, because it looks like one: `users` is under FORCE RLS, so counted as the
 * bare app role the query returns 0 on a database full of real tenants, the branch is skipped,
 * and the script inserts a SECOND platform super admin with the published password without
 * deleting anything. That is #3280's finding, and it is why every count in this fix runs with
 * `set_config('app.is_super_admin','true',true)` inside a transaction, exactly as
 * `scripts/seed-dev.ts:286-291` does.
 *
 * What this file pins:
 *   1. the gate's pure decision table — unset target, production, a whole-schema wipe, a
 *      populated database, a non-interactive terminal — and that `--yes` is what unlocks each;
 *   2. that the target is named without ever printing the credential embedded in `DATABASE_URL`;
 *   3. the typed-confirmation matcher, which is what a human answers instead of a flag;
 *   4. `db:state`: the read-only verdict that turns "may I run the seed?" into a question with an
 *      answer, and that its probe is SELECT-only and reuses #3281's `classify()`;
 *   5. `seed-fresh.ts`: the refusal happens before the first DELETE, the password comes from the
 *      environment, `--dry-run` rolls back, and the command is no longer called `prod:seed`;
 *   6. `drop-all.ts` — `db:drop` / `db:reset`, same class, named by the issue's ask #4 — is gated
 *      too, ahead of its `DROP SCHEMA public CASCADE`;
 *   7. the reference sweep: README, AGENTS.md, seed-api-data.ts and the credential baseline all
 *      say the new name, and the two #3282 literals the #3281 screen had to tolerate are gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  describeTarget,
  formatTarget,
  parseFlags,
  refusal,
  confirmationMatches,
  PROD_SEED_OPT_IN_ENV,
  DROP_OPT_IN_ENV,
  type GateInput,
} from '../../scripts/seed/destructive';
import { classify, type SeedCounts } from '../../scripts/seed/contents';
import { STATE_SQL, nextStep, readStateCounts } from '../../scripts/seed/state';

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const URL_WITH_SECRET = 'postgresql://nucrm_app:S3cr3t-Admin-Passwd@db.internal.example:6432/nucrm_prod';

/** Every field but the ones the gate reads, so a test only states what it is varying. */
const gate = (over: Partial<GateInput>): GateInput => ({
  script: 'seed-fresh',
  effect: 'deletes every user, tenant, role, session, pipeline and deal stage',
  target: { host: 'db.internal.example', port: '6432', database: 'nucrm_prod' },
  state: 'EMPTY',
  production: false,
  yes: false,
  interactive: true,
  wipe: false,
  ...over,
});

describe('#3282 the target is named, and never with its credential', () => {
  it('reads host, port and database out of the connection string', () => {
    expect(describeTarget(URL_WITH_SECRET)).toEqual({
      host: 'db.internal.example',
      port: '6432',
      database: 'nucrm_prod',
    });
  });

  it('never carries the password, the user, the query string or the schema', () => {
    const t = describeTarget(URL_WITH_SECRET)!;
    const rendered = JSON.stringify(t);
    expect(rendered).not.toContain('S3cr3t-Admin-Passwd');
    expect(rendered).not.toContain('nucrm_app');
    expect(rendered).not.toContain('sslmode');
    expect(Object.keys(t).sort()).toEqual(['database', 'host', 'port']);
  });

  it('defaults the port the way lib/db/pool.ts does, and reports no port it did not read', () => {
    expect(describeTarget('postgresql://localhost/nucrm_dev')!.port).toBe('5432');
    expect(describeTarget('postgresql://localhost:5433/nucrm_dev')!.port).toBe('5433');
  });

  it('returns null for anything it cannot name, instead of guessing', () => {
    expect(describeTarget(undefined)).toBeNull();
    expect(describeTarget('')).toBeNull();
    expect(describeTarget('not-a-url')).toBeNull();
    expect(describeTarget('mysql://localhost:3306/nucrm')).toBeNull();
    expect(describeTarget('postgresql://localhost:5432/')).toBeNull();
  });

  it('formats an unresolvable target as a word, not as a blank', () => {
    expect(formatTarget(describeTarget(URL_WITH_SECRET))).toBe('db.internal.example:6432/nucrm_prod');
    expect(formatTarget(null)).toBe('<DATABASE_URL unset or unparseable>');
  });
});

describe('#3282 the flag parser is the one scripts/migrate.ts already trained people on', () => {
  it('accepts --yes, -y and --confirm as the same opt-in', () => {
    expect(parseFlags(['--yes']).yes).toBe(true);
    expect(parseFlags(['-y']).yes).toBe(true);
    expect(parseFlags(['--confirm']).yes).toBe(true);
    expect(parseFlags([]).yes).toBe(false);
  });

  it('accepts --dry-run and keeps it distinct from --yes', () => {
    const f = parseFlags(['--dry-run']);
    expect(f).toEqual({ yes: false, dryRun: true });
    expect(parseFlags(['--dry-run', '--yes'])).toEqual({ yes: true, dryRun: true });
  });

  it('ignores a value that merely contains the flag, so a tag cannot opt you in', () => {
    expect(parseFlags(['0039_revert_yes_no']).yes).toBe(false);
    expect(parseFlags(['--dry-run=false']).dryRun).toBe(true);
  });
});

describe('#3282 the gate refuses before it is allowed to ask', () => {
  it('refuses a target it cannot name, whatever else is true', () => {
    const why = refusal(gate({ target: null, yes: true }))!;
    expect(why).toMatch(/cannot gate a database it cannot name/);
    expect(why).toMatch(/DATABASE_URL/);
  });

  it('refuses production until the operator names the opt-in', () => {
    expect(refusal(gate({ production: true }))).toMatch(/NODE_ENV=production/);
    expect(refusal(gate({ production: true, yes: true }))).toBeNull();
    expect(refusal(gate({ production: true }))).toContain(PROD_SEED_OPT_IN_ENV);
  });

  it('refuses a whole-schema wipe without --yes even on a database that counts empty', () => {
    // The count cannot be trusted here: #3280 is exactly the case where a populated database
    // reads as EMPTY. So for a DROP the flag is the only admissible evidence, and an
    // interactive confirmation is deliberately not enough.
    const why = refusal(gate({ script: 'drop-all', wipe: true, state: 'EMPTY', interactive: true }))!;
    expect(why).toMatch(/cannot be verified by counting/);
    expect(why).toMatch(/--yes/);
    expect(refusal(gate({ script: 'drop-all', wipe: true, yes: true }))).toBeNull();
  });

  it('refuses a POPULATED database without --yes, and says what POPULATED means', () => {
    const why = refusal(gate({ state: 'POPULATED' }))!;
    expect(why).toMatch(/POPULATED/);
    expect(why).toMatch(/rows this script did not write/);
    expect(refusal(gate({ state: 'SEEDED' }))).toBeNull();
    expect(refusal(gate({ state: 'POPULATED', yes: true }))).toBeNull();
  });

  it('refuses a non-interactive run with no flag, because the prompt would hang', () => {
    // scripts/migrate.ts:161-176 already established this rule: a readline question in CI
    // blocks until the job timeout, and a step that blocks is not a gate.
    const why = refusal(gate({ interactive: false }))!;
    expect(why).toMatch(/non-interactive/);
    expect(why).toMatch(/--yes/);
    expect(refusal(gate({ interactive: false, yes: true }))).toBeNull();
  });

  it('asks nothing when production, wipe and data are all absent and a human is present', () => {
    expect(refusal(gate({}))).toBeNull();
  });

  it('states which script is refusing, so a log line is attributable', () => {
    expect(refusal(gate({ script: 'drop-all', production: true }))).toContain('drop-all');
  });

  it('orders the reasons: an unnameable target outranks every other signal', () => {
    const why = refusal(gate({ target: null, production: true, wipe: true, state: 'POPULATED' }))!;
    expect(why).toMatch(/cannot name/);
    expect(why).not.toMatch(/NODE_ENV=production/);
  });
});

describe('#3282 a human answers by typing the database name, not by pressing enter', () => {
  it('matches the name exactly, and nothing else', () => {
    expect(confirmationMatches('nucrm_prod', 'nucrm_prod')).toBe(true);
    expect(confirmationMatches('nucrm_prod', ' nucrm_prod ')).toBe(true);
    expect(confirmationMatches('nucrm_prod', 'yes')).toBe(false);
    expect(confirmationMatches('nucrm_prod', '')).toBe(false);
    expect(confirmationMatches('nucrm_prod', 'nucrm_de')).toBe(false);
    expect(confirmationMatches('nucrm_prod', 'nucrm_production')).toBe(false);
  });

  it('is case-sensitive, because a typo is not a confirmation', () => {
    expect(confirmationMatches('nucrm_prod', 'NUCRM_PROD')).toBe(false);
  });

  it('refuses to compare against a target it never resolved', () => {
    expect(confirmationMatches('', 'anything')).toBe(false);
  });
});

describe('#3282 db:state answers the question prod:seed used to be a gamble on', () => {
  const counts = (over: Partial<SeedCounts>): SeedCounts => ({
    users: 0, superAdmins: 0, tenants: 0, demoTenant: 0, demoUsers: 0, ...over,
  });

  it('probes the identity of the fixtures, not an id it cannot know', () => {
    // seed-dev.ts writes fixed ids; seed-fresh.ts writes uuids generated at run time, so the
    // only probe that sees both is one keyed on what the fixtures are called.
    expect(STATE_SQL).toMatch(/slug LIKE 'nucrm-demo-%'/);
    expect(STATE_SQL).toMatch(/admin@nucrm\.com/);
    expect(STATE_SQL).toMatch(/@test\.com/);
    expect(STATE_SQL).toMatch(/app\.is_super_admin|is_super_admin/);
  });

  it('is SELECT-only, because a verifier that writes is not a verifier', () => {
    expect(STATE_SQL.trim().split(/\s+/)[0]).toBe('SELECT');
    expect(STATE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|VACUUM)\b/i);
    expect(STATE_SQL.split(';')).toHaveLength(1);
  });

  it('maps the probe rows onto the counts #3281 already classifies', () => {
    expect(readStateCounts([{ users: 3, super_admins: 1, tenants: 2, demo_tenant: 1, demo_users: 2 }]))
      .toEqual({ users: 3, superAdmins: 1, tenants: 2, demoTenant: 1, demoUsers: 2 });
    expect(readStateCounts([])).toEqual({
      users: 0, superAdmins: 0, tenants: 0, demoTenant: 0, demoUsers: 0,
    });
    expect(readStateCounts([{ users: null, super_admins: undefined, tenants: '4', demo_tenant: 0, demo_users: 0 }]).tenants).toBe(4);
  });

  it('reuses #3281 classify(), so there is one definition of POPULATED in this repository', () => {
    expect(classify(counts({})).state).toBe('EMPTY');
    expect(classify(counts({ users: 5, superAdmins: 1, tenants: 1, demoTenant: 1, demoUsers: 5 })).state).toBe('SEEDED');
    expect(classify(counts({ users: 9, tenants: 3, demoTenant: 1, demoUsers: 2 })).state).toBe('POPULATED');
  });

  it('names the safe next command for each verdict', () => {
    expect(nextStep(classify(counts({})))).toContain('db:seed');
    expect(nextStep(classify(counts({})))).not.toMatch(/DELETE/);
    const seeded = nextStep(classify(counts({ users: 5, tenants: 1, demoTenant: 1, demoUsers: 5 })));
    expect(seeded).toContain('already seeded');
    const populated = nextStep(classify(counts({ users: 9, tenants: 3 })));
    expect(populated).toMatch(/back ?up/);
    expect(populated).toMatch(/--yes/);
  });
});

describe('#3282 seed-fresh.ts refuses before it deletes, and seeds a password nobody published', () => {
  const src = read('scripts/seed-fresh.ts');

  it('no longer contains the published credential', () => {
    expect(src).not.toContain("'Admin123!'");
    expect(src).not.toMatch(/hashPassword\(\s*['"`]/);
  });

  it('takes the credential from the environment through #3281 resolver, and stops without it', () => {
    expect(src).toMatch(/resolveSeedPassword\(process\.env\)/);
    expect(src).toMatch(/credential\.error/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it('names the target it is about to destroy', () => {
    expect(src).toMatch(/describeTarget\(process\.env\.DATABASE_URL\)/);
    expect(src).toMatch(/formatTarget\(/);
  });

  it('reads both opt-ins literally, so guard:env-coverage can see them', () => {
    expect(src).toMatch(/process\.env\.NUCRM_ALLOW_PROD_SEED === '1'/);
    expect(PROD_SEED_OPT_IN_ENV).toBe('NUCRM_ALLOW_PROD_SEED');
  });

  it('counts inside the bypass context, and refuses before the first delete', () => {
    const setConfig = src.indexOf(`set_config('app.is_super_admin', 'true', true)`);
    const probe = src.indexOf('client.query(STATE_SQL)');
    // `refusal(` alone matches the pre-connection early gate too, which is earlier than
    // the probe by design; the ordering claim is about the decision made from the counts.
    const refuse = src.indexOf('const blocked = refusal(');
    const firstDelete = src.search(/db\.delete\(/);
    expect(setConfig).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(setConfig);
    expect(refuse).toBeGreaterThan(probe);
    expect(firstDelete).toBeGreaterThan(refuse);
    expect(src).toMatch(/throw new Error\(blocked\)/);
  });

  it('rolls the decision transaction back, so a refusal writes nothing', () => {
    expect(src).toMatch(/ROLLBACK/);
    expect(src).toMatch(/dryRun/);
  });

  it('stays inside one pinned connection and one transaction, like #2628 left seed-dev', () => {
    expect(src).toMatch(/new Pool\(\{ connectionString: process\.env\.DATABASE_URL, max: 1, ssl: pgSslConfig\(\) \}\)/);
    expect(src).toMatch(/drizzle\(client/);
    expect(src).toMatch(/await client\.query\('BEGIN'\)/);
  });

  it('asks a human to type the database name when there is no flag', () => {
    expect(src).toMatch(/confirmationMatches\(/);
    expect(src).toMatch(/createInterface|readline/);
  });

  it('still prints the email it seeded, and no longer prints a password at all', () => {
    expect(src).toMatch(/admin@nucrm\.com/);
    // The banner names the variable instead of the value: `\$${SEED_PASSWORD_ENV}` is
    // what gets printed, so the credential never reaches the log, the CI annotation
    // parser, or this file's own git diff.
    expect(src).toMatch(/Password:.*\$\{SEED_PASSWORD_ENV\}/);
    expect(src).not.toMatch(/Password:\s*\$\{?seedPassword/);
    expect(src).not.toMatch(/Password:\s*['"][^'"]{6,}['"]/);
  });
});

describe('#3282 the rest of the destructive surface named in ask #4 is gated too', () => {
  it('drop-all.ts refuses before DROP SCHEMA public CASCADE', () => {
    const src = read('scripts/drop-all.ts');
    // Ordered on the statements that run, not on the words in the header: the doc
    // comment names `DROP SCHEMA public CASCADE` before any code exists, and the guard
    // it describes is a bare identifier in the import list.
    const refuse = src.indexOf('const blocked = refusal(');
    const drop = src.indexOf(`await pool.query('DROP SCHEMA public CASCADE')`);
    const connect = src.indexOf('new Pool(');
    expect(refuse).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(refuse);
    expect(connect).toBeGreaterThan(refuse);
    expect(src).toMatch(/if \(blocked\)[\s\S]*process\.exit\(1\)/);
    expect(src).toMatch(/wipe: true/);
    expect(src).toMatch(/process\.env\.NUCRM_ALLOW_DROP === '1'/);
    expect(DROP_OPT_IN_ENV).toBe('NUCRM_ALLOW_DROP');
    expect(src).toMatch(/describeTarget\(process\.env\.DATABASE_URL\)/);
    expect(src).toMatch(/confirmationMatches\(/);
    // ask 3 wants a backup before the wipe. The script names the dump an operator can actually
    // trust instead of taking one itself — a pg_dump run as the app role is incomplete under
    // PP-014, and an auto-taken incomplete backup is the thing that makes the wipe permanent.
    expect(src).toMatch(/bash scripts\/backup-db\.sh/);
    expect(src).toMatch(/npm run backup:verify/);
  });

  it('keeps the schema-rebuild grants it always had, and says why they are still there', () => {
    const src = read('scripts/drop-all.ts');
    expect(src).toMatch(/GRANT ALL ON SCHEMA public TO public/);
    expect(src).toMatch(/#3282/);
  });

  it('package.json renames the command to what it actually does', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['prod:seed']).toBeUndefined();
    expect(pkg.scripts['db:seed:from-empty']).toBe('npx tsx scripts/seed-fresh.ts');
    expect(pkg.scripts['db:state']).toBe('npx tsx scripts/db-state.ts');
    expect(Object.keys(pkg.scripts).filter((k) => /^prod:.*seed/i.test(k))).toEqual([]);
  });

  it('documents the refusal where an operator will read it', () => {
    const readme = read('README.md');
    expect(readme).not.toMatch(/npm run prod:seed/);
    expect(readme).toMatch(/db:seed:from-empty/);
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/db:seed:from-empty/);
    expect(agents).toMatch(/NUCRM_ALLOW_PROD_SEED/);
    expect(readFileSync(join(ROOT, '.env.example'), 'utf8')).toMatch(/NUCRM_ALLOW_PROD_SEED/);
  });

  it('points the other seed scripts at the renamed command', () => {
    expect(read('scripts/seed-api-data.ts')).toMatch(/db:seed:from-empty/);
    expect(read('scripts/seed-api-data.ts')).not.toMatch(/Run seed-fresh first/);
  });
});

describe('#3282 the #3281 screen no longer has to tolerate anything', () => {
  const baseline = JSON.parse(read('scripts/seed-credentials-baseline.json'));

  it('empties the baseline that #3281 left for this issue', () => {
    expect(Object.keys(baseline).filter((k) => k !== '_comment')).toEqual([]);
    expect(baseline._comment).toMatch(/#3282/);
    expect(baseline._comment).toMatch(/empty/i);
  });

  it('removes the billing harness default instead of baselining it', () => {
    const src = read('scripts/billing-lifecycle-test.ts');
    expect(src).not.toMatch(/DEFAULT_ADMIN_PASSWORD = 'password123'/);
    expect(src).toMatch(/TEST_ADMIN_PASSWORD/);
    expect(src).toMatch(/is required/);
  });

  it('runs the screen for real and comes back clean with nothing allowed', () => {
    const { analyse } = require('../../scripts/check-seed-credentials.mjs');
    const { findings, allowed } = analyse({ root: ROOT, baseline: {} });
    expect(findings).toEqual([]);
    expect(allowed).toBe(0);
  });
});

describe('#3282 the destructive screen is wired where a regression cannot slip past', () => {
  const ci = read('.github/workflows/ci.yml');
  // The coordinates `docs/README.md` and the register cite by line number, pinned against
  // this file's own content rather than a branch ref — the #3010 rule. An insert above any
  // of them would have moved it; below `:447` nothing can.
  const COORDINATES: Array<[number, string]> = [
    [221, 'check-audit-baseline.mjs'],
    [254, 'check-semgrep-baseline.mjs'],
    [401, 'Schema drift check (column-level)'],
    [447, 'check-env-coverage.mjs'],
  ];
  const jobStart = ci.indexOf('\n  destructive-gate:');
  const job = jobStart === -1 ? '' : ci.slice(jobStart, ci.indexOf('\n  # PP-059 / #3241', jobStart));

  const pkgScripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
  const workflows = readdirSync(join(ROOT, '.github/workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => readFileSync(join(ROOT, '.github/workflows', f), 'utf8'))
    .join('\n');
  /** Whether any workflow runs this alias — by name, or by the file the alias points at. */
  const hasStep = (alias: string): boolean => {
    if (workflows.includes(`npm run ${alias}`)) return true;
    const file = /(?:node|npx\s+tsx|tsx)\s+(?:--import\s+\S+\s+)?([\w./-]+\.(?:mjs|ts|mts))/.exec(pkgScripts[alias] ?? '')?.[1];
    return Boolean(file && workflows.includes(file));
  };

  it('package.json defines the alias the workflow invokes', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['guard:destructive-gate']).toContain('scripts/check-destructive-gate.mjs');
  });

  it('declares the job with an opt-out variable and a name an operator recognises', () => {
    expect(jobStart).toBeGreaterThan(-1);
    expect(job).toContain('name: Destructive scripts name their own opt-in (#3282)');
    expect(job).toContain("if: vars.DESTRUCTIVE_GATE_GUARD_ENABLED != 'false'");
  });

  it('sits below every cited coordinate and leaves constraint-vocab the last job', () => {
    const lines = ci.split('\n');
    for (const [line, mustContain] of COORDINATES) {
      expect(lines[line - 1], `ci.yml:${line}`).toContain(mustContain);
    }
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    expect(jobKeys.indexOf('destructive-gate')).toBe(jobKeys.length - 2);
    expect(jobKeys.indexOf('destructive-gate')).toBeGreaterThan(jobKeys.indexOf('seed-credential'));
    expect(ci.slice(0, jobStart).split('\n').length).toBeGreaterThan(447);
  });

  it('runs the package.json alias in both steps rather than a hand-copied command', () => {
    expect(job).toContain('npm run guard:destructive-gate');
    expect((job.match(/npm run guard:destructive-gate/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('demands a failure from the negative control, and the right reasons', () => {
    // the `if` form. A bare `cmd | tee` under GitHub's `bash -e` ends the step at the
    // pipeline, so the step reports the guard's own exit 1 and never reaches the reason
    // checks — the way #3284's first CI run and #3283's register entry both record it.
    expect(job).toMatch(/if npm run guard:destructive-gate -- \\/);
    expect(job).not.toMatch(/^\s*npm run guard:destructive-gate.*\|\s*tee/m);
    expect(job).not.toContain('${PIPESTATUS[0]}');
    expect(job).toContain('#3282 the guard PASSED a tree holding a dry-run-only DROP SCHEMA');
    expect(job).toContain('for want in SCHEMA_WIPE_UNGATED TABLE_WIPE_UNGATED UNSCOPED_DELETE_UNGATED; do');
    expect(job).toContain('grep -q "^BASELINE_UNREASONED"');
    expect(job).toContain('grep -q "^BASELINE_STALE"');
  });

  it('is counted by the docs census, which is a check rather than prose', () => {
    const readme = read('docs/README.md');
    const para = /enforces \*\*(\d+)\*\*[^—]*—([\s\S]*?)—\s*plus/.exec(readme);
    expect(para).not.toBeNull();
    const named = [...para![2].matchAll(/`(guard:[a-z-]+)`/g)].map((m) => m[1]);
    const invoked = new Set(
      [...ci.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]),
    );
    expect(named).toContain('guard:destructive-gate');
    expect(Number(para![1])).toBe(named.length);
    for (const alias of named) expect(invoked.has(alias), `${alias} claimed but not invoked`).toBe(true);
    const total = Object.keys(JSON.parse(read('package.json')).scripts).filter((k) => k.startsWith('guard:'));
    expect(readme).toMatch(new RegExp(`defines \\*\\*${total.length}\\*\\* aliases in total`));
    // and exactly one alias has no workflow step at all, which the paragraph says by name.
    // "Wired" here is the census's own sense: three aliases run in ci.yml as bare commands
    // and three more only in `nightly-soak.yml`, so a ci.yml-only read of `npm run` would
    // call six wired aliases unwired — the mistake #3239 exists to catch.
    expect(total.filter((k) => !hasStep(k))).toEqual(['guard:migration-redecl']);
  });

  it('is the seventh step of the local pre-merge screen', () => {
    const pre = read('scripts/pre-merge-check.sh');
    expect(pre).toContain('npm run guard:destructive-gate');
    // #3298 appended guard:cron-auth as an eighth, by name, in that issue's ask 2.
    expect([...pre.matchAll(/▶ (\d+)\/8/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

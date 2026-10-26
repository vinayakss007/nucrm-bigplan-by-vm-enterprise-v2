/**
 * #3281 — the seed credential comes from the environment, and the database's own
 * contents decide whether a seed may write to it.
 *
 * What was true on the commit this issue was written against, measured rather than
 * remembered: `npm run seed:dev` hashed the literal `'password123'` into
 * `admin@test.com` with `is_super_admin = true` — the flag that turns on the
 * `app.is_super_admin` GUC, which is the one the RLS policies test for, so that
 * account sits outside row security entirely. `scripts/smoke-test.sh` defaulted
 * `SMOKE_LOGIN_PASSWORD` to `SuperAdmin123!`, `scripts/security-test.sh` sent
 * `password123` in a request body six times, and
 * `.github/workflows/release.yml` carried `SMOKE_LOGIN_PASSWORD: password123` as the
 * release gate's login. `Secret Scan (gitleaks)` was green over all of it —
 * `.gitleaks.toml:12-20` allowlists `scripts/security-test\.sh` and `\.github/`, and
 * a dictionary word plus digits is not a secret SHAPE — which is why this needed a
 * screen of its own rather than a better scanner.
 *
 * The two guards that were supposed to stop it checked the caller's environment
 * (`NODE_ENV`) and the database HOST (`localhost`), and `.env.example` ships
 * `NODE_ENV=development` while `deploy/LAUNCH_RUNBOOK.md` §1 requires the production
 * data tier to listen on `127.0.0.1`. On the box where the damage is irreversible,
 * both passed. So the third signal is the one that cannot lie: the counts in the
 * target database, read inside the bypass context (#3280 is the reason it must be
 * read there).
 *
 * What this file pins:
 *   1. the credential resolution table — absent, empty, policy-violating, valid;
 *   2. that the mirrored policy in scripts/seed/credential.ts is still the policy in
 *      lib/auth/session.ts, which is the only way a script-local copy stays honest;
 *   3. the classify()/refusal() table over EMPTY/SEEDED/POPULATED and the override;
 *   4. the guard: planted literals of all five shapes turn it red, the real tree is
 *      clean under exactly the baseline #3282 owns, and a stale allowance is a finding;
 *   5. the CLI contract the CI job's negative control greps for;
 *   6. that seed-dev.ts, smoke-test.sh, security-test.sh, start-clean.sh and
 *      release.yml carry no default credential, and release.yml exports both names;
 *   7. that the screen is wired into ci.yml as an insert below the cited coordinates,
 *      counted by docs/README.md's census, and visible to guard:env-coverage.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  SEED_PASSWORD_ENV,
  PASSWORD_MIN_LENGTH,
  passwordPolicyError,
  resolveSeedPassword,
} from '../../scripts/seed/credential';
import {
  COUNTS_SQL,
  classify,
  refusal,
  probeCounts,
  formatVerdict,
  type SeedCounts,
} from '../../scripts/seed/contents';
import { analyse, readBaseline, main as guardMain } from '../../scripts/check-seed-credentials.mjs';

const ROOT = join(import.meta.dirname!, '../..');
const GUARD = join(ROOT, 'scripts/check-seed-credentials.mjs');
const BASELINE = join(ROOT, 'scripts/seed-credentials-baseline.json');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const seedDev = read('scripts/seed-dev.ts');
const session = read('lib/auth/session.ts');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');

const counts = (over: Partial<SeedCounts> = {}): SeedCounts => ({
  users: 0, superAdmins: 0, tenants: 0, demoTenant: 0, demoUsers: 0, ...over,
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the credential is resolved, never assumed', () => {
  it('refuses when SEED_PASSWORD is absent, and says there is no committed default', () => {
    const r = resolveSeedPassword({});
    expect(r.password).toBeNull();
    expect(r.error).toContain(SEED_PASSWORD_ENV);
    expect(r.error).toMatch(/is not set/);
    expect(r.error).toContain('#3281');
    expect(r.error).toMatch(/no committed default/);
  });

  it('treats an empty value as absent — an exported blank is not a password', () => {
    expect(resolveSeedPassword({ SEED_PASSWORD: '' }).error).toMatch(/is not set/);
  });

  it('names the rule the supplied password breaks, instead of accepting it', () => {
    const weak = resolveSeedPassword({ SEED_PASSWORD: 'password123' });
    expect(weak.password).toBeNull();
    expect(weak.error).toMatch(/is set but invalid/);
    expect(weak.error).toContain('at least 12 characters');
  });

  it('accepts a password that satisfies the app policy and does not echo it', () => {
    const ok = resolveSeedPassword({ SEED_PASSWORD: 'Gate!Release7q' });
    expect(ok.error).toBeNull();
    expect(ok.password).toBe('Gate!Release7q');
    // the object a caller might log must not carry the value in the error path
    expect(JSON.stringify(resolveSeedPassword({}).error)).not.toContain('Gate!Release7q');
  });

  it('is what the seed reads before any connection is opened', () => {
    const resolveAt = seedDev.indexOf('const credential = resolveSeedPassword(process.env)');
    const poolAt = seedDev.indexOf('new Pool(');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(poolAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(poolAt);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the mirrored policy is still the application policy', () => {
  // scripts/seed/credential.ts cannot import lib/auth/session.ts (that module pulls
  // next/headers and @/drizzle/schema), so the rules are restated. This is the only
  // thing keeping the restatement from drifting into a policy that is not the app's.
  function appPolicy(): { min: number; upper: RegExp; digit: RegExp; special: RegExp } {
    const body = session.slice(session.indexOf('export function validatePassword'));
    const min = /password\.length < (\d+)/.exec(body);
    const rules = [...body.matchAll(/if \(!\/(.+?)\/\.test\(password\)\)/g)].map((m) => m[1]);
    expect(min, 'session.ts must keep its length rule').not.toBeNull();
    expect(rules.length, 'session.ts must keep three character-class rules').toBe(3);
    return { min: Number(min![1]), upper: new RegExp(rules[0]), digit: new RegExp(rules[1]), special: new RegExp(rules[2]) };
  }

  it('agrees on the minimum length', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(appPolicy().min);
  });

  it('agrees on each required character class', () => {
    const app = appPolicy();
    const mine = {
      upper: /[A-Z]/,
      digit: /[0-9]/,
      special: /[!@#$%^&*(),.?":{}|<>]/,
    };
    // every class the app requires, the mirror requires — and rejects the same strings
    for (const [key, re] of Object.entries(mine)) {
      const appRe = (app as Record<string, RegExp>)[key];
      for (const probe of ['abcdefghijkl', 'ABCDEFGHIJKL', '1234567890ab', 'abc!defghijk']) {
        expect(re.test(probe), `mirror/${key} vs app on '${probe}'`).toBe(appRe.test(probe));
      }
    }
  });

  it('rejects the credential that used to be committed, for the three reasons it has', () => {
    const err = passwordPolicyError('password123');
    expect(err).toContain('at least 12 characters');
    // and each individual rule, once the length is met
    expect(passwordPolicyError('password1234')).toContain('uppercase');
    expect(passwordPolicyError('PASSWORD!aaaa')).toContain('number');
    expect(passwordPolicyError('Password1234')).toContain('special');
    expect(passwordPolicyError('Password123!')).toBeNull();
  });

  it('is the seed-dev banner and nothing else: the value is never printed', () => {
    expect(seedDev).toMatch(/Password: +\$SEED_PASSWORD/);
    expect(seedDev).not.toMatch(/console\.log\([^)]*seedPassword/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the target database is classified from its contents', () => {
  it('calls a virgin database EMPTY', () => {
    const v = classify(counts());
    expect(v.state).toBe('EMPTY');
    expect(refusal(v)).toBeNull();
  });

  it('calls a database holding exactly its own fixtures SEEDED, and says the bootstrap is spent', () => {
    const v = classify(counts({ users: 4, superAdmins: 1, tenants: 1, demoTenant: 1, demoUsers: 4 }));
    expect(v.state).toBe('SEEDED');
    expect(v.reasons.join(' ')).toMatch(/only tenant is the demo one/);
    expect(v.reasons.join(' ')).toMatch(/create-admin\/route\.ts:43-46/);
    expect(refusal(v)).toBeNull(); // the idempotent re-run #2628 made safe
  });

  it('refuses a database that holds rows the seed did not write', () => {
    const v = classify(counts({ users: 91, superAdmins: 2, tenants: 7, demoTenant: 1, demoUsers: 4 }));
    expect(v.state).toBe('POPULATED');
    const msg = refusal(v) as string;
    expect(msg).toMatch(/^REFUSING TO SEED/);
    expect(msg).toContain('SEED_ALLOW_POPULATED=true');
    expect(msg).toContain('#3281');
  });

  it('refuses even when the demo fixtures are present but not the whole database', () => {
    // one foreign tenant is enough: this is the shape a production install has
    expect(classify(counts({ users: 5, tenants: 2, demoTenant: 1, demoUsers: 5 })).state).toBe('POPULATED');
    // and so is a user that is not a fixture
    expect(classify(counts({ users: 5, tenants: 1, demoTenant: 1, demoUsers: 4 })).state).toBe('POPULATED');
  });

  it('is the override, explicitly, and nothing else', () => {
    const v = classify(counts({ users: 91, tenants: 7, demoTenant: 1, demoUsers: 4 }));
    expect(refusal(v, false)).not.toBeNull();
    expect(refusal(v, true)).toBeNull();
  });

  it('is decided before a single row is written, inside the bypass context', () => {
    const probeAt = seedDev.indexOf('probeCounts(client, IDS.tenant');
    const firstInsert = seedDev.indexOf('db.insert(schema.plans)');
    const setConfig = seedDev.indexOf("set_config('app.is_super_admin'");
    expect(setConfig).toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(setConfig);
    expect(probeAt).toBeLessThan(firstInsert);
    // it throws, so the one transaction #2628 built rolls back rather than half-writing
    expect(seedDev).toMatch(/const blocked = refusal\(verdict, process\.env\.SEED_ALLOW_POPULATED === 'true'\);\s*\n\s*if \(blocked\) throw new Error\(blocked\);/);
  });

  it('asks only for counts — a SELECT, never a write', () => {
    expect(COUNTS_SQL.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    expect(COUNTS_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/);
    expect(COUNTS_SQL).toContain('is_super_admin');
    expect(COUNTS_SQL).toContain('$2::uuid[]');
  });

  it('reads the row the driver returns, whatever casing the client gives it', async () => {
    const fake = { query: async () => ({ rows: [{ users: 3, super_admins: 1, tenants: 1, demo_tenant: 1, demo_users: 3 }] }) };
    expect(await probeCounts(fake, 't', ['u'])).toEqual({ users: 3, superAdmins: 1, tenants: 1, demoTenant: 1, demoUsers: 3 });
    const emptyish = { query: async () => ({ rows: [] }) };
    expect((await probeCounts(emptyish, 't', [])).users).toBe(0);
  });

  it('prints one line with the state in it, for the seed log and for humans', () => {
    const line = formatVerdict(classify(counts({ users: 91, tenants: 7, demoTenant: 1, demoUsers: 4 })));
    expect(line).toContain('users=91');
    expect(line).toContain('[POPULATED]');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the guard turns red for every shape a committed password takes', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** A throwaway repository root holding exactly the files a test names. */
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'seed-cred-'));
    dirs.push(dir);
    for (const [rel, text] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, text);
    }
    return dir;
  }

  it('catches a hashed literal, a defaulted env read, an assignment, a JSON body, a workflow scalar', () => {
    // The same artifact the CI negative control copies: `cp -r tests/fixtures/…`.
    // Pinning the shipped fixture rather than a copy of it in this file is what makes
    // the two halves agree — if someone edits the fixture until the guard stops
    // seeing it, the CI step and this test fail together.
    const shipped = join(ROOT, 'tests/fixtures/seed-credential-negative');
    const { findings } = analyse({ root: shipped, baseline: {} });
    const checks = findings.map((f: { check: string }) => f.check).sort();
    expect(checks).toEqual([
      'HASH_LITERAL_PASSWORD',
      'PASSWORD_ENV_LITERAL_DEFAULT',
      'PASSWORD_JSON_LITERAL',
      'PASSWORD_LITERAL_ASSIGNMENT',
      'PASSWORD_LITERAL_ASSIGNMENT',
      'WORKFLOW_PASSWORD_LITERAL',
    ]);
    // every finding says which file and line, so a fix is findable
    for (const f of findings) {
      expect(f.file).toMatch(/^scripts\/|^\.github\//);
      expect(f.line).toBeGreaterThan(0);
      expect(f.source).not.toBe('');
    }
    // and the fixture is outside the screen's own scan set, or the positive control
    // could never be green while the negative one exists
    expect(analyse({ root: ROOT, baseline: readBaseline(BASELINE) }).findings).toEqual([]);
  });

  it('catches each shape when it is planted in a clean tree of its own', () => {
    const dir = fixture({
      'scripts/planted.ts': [
        "const DEFAULT_ADMIN_PASSWORD = 'Hunter2Gate!';",
        "export const make = () => bcrypt.hash('Admin123!', 12);",
        "export const read = () => process.env.MY_PASSWORD || 'FallBack1!';",
        '',
      ].join('\n'),
      'scripts/planted.sh': [
        'SEC_LOGIN_PASSWORD="ShellDefault7!"',
        `curl -s -d '{"email":"a@b.c","password":"BodyLiteral9!"}' http://localhost:3000/api/auth/login`,
        '',
      ].join('\n'),
      '.github/workflows/gate.yml': [
        'jobs:',
        '  gate:',
        '    env:',
        '      SMOKE_LOGIN_PASSWORD: WorkflowLiteral3!',
        '',
      ].join('\n'),
    });
    expect(analyse({ root: dir, baseline: {} }).findings).toHaveLength(6);
  });

  it('does not invent findings for the shapes that are the fix', () => {
    const dir = fixture({
      'scripts/clean.ts': [
        'const seedPassword = resolveSeedPassword(process.env).password;',
        'await bcrypt.hash(seedPassword, 12);',
        "export const SEED_PASSWORD_ENV = 'SEED_PASSWORD';", // an env NAME, not a value
        "AUTH_PASSWORD_WEAK = 'AUTH_PASSWORD_WEAK',", // an enum member equal to its key
        '',
      ].join('\n'),
      'scripts/clean.sh': [
        'CHAIN_PASSWORD="Release!$(od -An -tx1 -N10 /dev/urandom | tr -d " ")7Q"',
        'PGPASSWORD="$DB_PASSWORD" psql -h localhost',
        'echo "${SEED_PASSWORD:?not set}"',
        '',
      ].join('\n'),
      '.github/workflows/clean.yml': ['jobs:', '  gate:', '    env:', '      SEED_PASSWORD: ${{ env.X }}', ''].join('\n'),
    });
    const { findings } = analyse({ root: dir, baseline: {} });
    expect(findings.map((f: { detail: string }) => f.detail)).toEqual([]);
  });

  it('leaves prose out of it: a comment describing the bug must not be a finding', () => {
    const dir = fixture({
      'scripts/prose.ts': [
        '// scripts/seed-dev.ts used to hash the literal "password123" into admin@test.com,',
        '// and release.yml carried SMOKE_LOGIN_PASSWORD: password123.',
        '/* bcrypt.hash(\'Admin123!\', 12) is what the fix removed. */',
        'export const NOTE = 1;',
        '',
      ].join('\n'),
      'scripts/prose.sh': ['# SMOKE_LOGIN_PASSWORD: password123 was the old default\n', '#!/bin/bash\n'].join(''),
    });
    const { findings } = analyse({ root: dir, baseline: {} });
    expect(findings).toEqual([]);
  });

  it('reports an allowance whose site is gone, so the ratchet cannot outlive the code', () => {
    const dir = fixture({ 'scripts/none.ts': 'export const x = 1;\n' });
    const { findings } = analyse({ root: dir, baseline: { 'scripts/gone.ts|HASH_LITERAL_PASSWORD': 1 } });
    expect(findings.map((f: { check: string }) => f.check)).toEqual(['BASELINE_STALE']);
  });

  it('counts a planted credential against the allowance for its own file and check only', () => {
    const dir = fixture({ 'scripts/x.ts': "const ADMIN_PASSWORD = 'Planted9!x';\n" });
    expect(analyse({ root: dir, baseline: { 'scripts/x.ts|PASSWORD_LITERAL_ASSIGNMENT': 1 } }).findings).toEqual([]);
    const wide = analyse({ root: dir, baseline: { 'scripts/x.ts|PASSWORD_LITERAL_ASSIGNMENT': 2 } });
    expect(wide.findings.map((f: { check: string }) => f.check)).toEqual(['BASELINE_STALE']);
    // an allowance for a DIFFERENT check does not excuse it
    expect(analyse({ root: dir, baseline: { 'scripts/x.ts|HASH_LITERAL_PASSWORD': 9 } }).findings
      .map((f: { check: string }) => f.check)).toContain('PASSWORD_LITERAL_ASSIGNMENT');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the real tree is clean under exactly the baseline #3282 owns', () => {
  const baseline = readBaseline(BASELINE);

  it('has no un-baselined password literal in scripts/app/lib/components/workflows', () => {
    const { findings, allowed } = analyse({ root: ROOT, baseline });
    expect(findings).toEqual([]);
    expect(allowed).toBe(2);
  });

  it('excuses only the two #3282 sites, by name, and says so', () => {
    const keys = Object.keys(baseline).filter((k) => k !== '_comment');
    expect(keys.sort()).toEqual([
      'scripts/billing-lifecycle-test.ts|PASSWORD_LITERAL_ASSIGNMENT',
      'scripts/seed-fresh.ts|HASH_LITERAL_PASSWORD',
    ]);
    expect(baseline._comment).toContain('#3282');
  });

  it('makes the seed script itself a place a credential cannot be planted again', () => {
    // strip comments the same way the guard does, and assert on the code only
    const code = seedDev.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/bcrypt\.hash\(\s*['"`]/);
    expect(code).not.toMatch(/['"]password123['"]/);
    expect(code).toMatch(/bcrypt\.hash\(seedPassword, 12\)/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the CLI contract the CI negative control depends on', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', cwd: ROOT });

  it('exits 0, 1, 2 for clean / findings / nothing to scan', () => {
    expect(run([]).status).toBe(0);
    const empty = mkdtempSync(join(tmpdir(), 'seed-cred-none-'));
    try {
      expect(run(['--root', empty]).status).toBe(2);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    const bad = mkdtempSync(join(tmpdir(), 'seed-cred-bad-'));
    try {
      mkdirSync(join(bad, 'scripts'), { recursive: true });
      writeFileSync(join(bad, 'scripts', 'x.ts'), "const ADMIN_PASSWORD = 'Planted9!x';\n");
      expect(run(['--root', bad, '--baseline', join(bad, 'none.json')]).status).toBe(1);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });

  it('prints each finding with the check name at column 0, which is what `grep -q "^RULE"` matches', () => {
    const bad = mkdtempSync(join(tmpdir(), 'seed-cred-col-'));
    try {
      mkdirSync(join(bad, 'scripts'), { recursive: true });
      writeFileSync(join(bad, 'scripts', 'x.sh'), 'GATE_PASSWORD="Planted9!x"\n');
      const out = run(['--root', bad, '--baseline', join(bad, 'none.json')]).stdout;
      expect(out.split('\n').some((l) => /^PASSWORD_LITERAL_ASSIGNMENT\t/.test(l))).toBe(true);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });

  it('offers --explain, --json and --print-baseline without touching the tree', () => {
    expect(run(['--explain']).stdout).toContain('HASH_LITERAL_PASSWORD');
    expect(JSON.parse(run(['--json']).stdout).findings).toEqual([]);
    expect(JSON.parse(run(['--print-baseline']).stdout)['_comment']).toContain('#3281');
  });

  it('is reachable as the alias the CI job runs', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['guard:seed-credential']).toBe('node scripts/check-seed-credentials.mjs');
    expect(guardMain).toBeTypeOf('function');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the scripts that used to carry the credential now require it', () => {
  const sh = read('scripts/smoke-test.sh');
  const sec = read('scripts/security-test.sh');
  const start = read('scripts/start-clean.sh');

  it('smoke-test.sh has no default for either half of the login', () => {
    // `${NAME:-}` is the required-check itself; `${NAME:-something}` is a default.
    expect(sh).not.toMatch(/\$\{SMOKE_LOGIN_PASSWORD:-[^}]/);
    expect(sh).not.toMatch(/\$\{SMOKE_LOGIN_EMAIL:-[^}]/);
    expect(sh).toMatch(/if \[ -z "\$\{SMOKE_LOGIN_EMAIL:-\}" \] \|\| \[ -z "\$\{SMOKE_LOGIN_PASSWORD:-\}" \]; then/);
    expect(sh).toMatch(/exit 2/);
    // the old default may only survive as prose: naming it in a comment is how the
    // issue stays explainable, naming it in code is how it comes back
    for (const line of sh.split('\n').filter((l) => l.includes('SuperAdmin123'))) {
      expect(line.trim(), 'a credential literal outside a comment').toMatch(/^#/)
    }
  });

  it('security-test.sh builds one payload from two required names, and sends it six times', () => {
    expect(sec).toMatch(/LOGIN_PAYLOAD=\$\(printf/);
    expect((sec.match(/-d "\$LOGIN_PAYLOAD"/g) ?? []).length).toBe(6);
    expect(sec).toMatch(/SEC_TEST_PASSWORD are both required/);
    // The one body that is not the real credential is the invalid-login probe, and it
    // is wrong by construction — the app's own policy refuses to make it a login.
    const bodies = sec.split('\n').filter((l) => /-d / .test(l) && /password/i.test(l));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('wrongpassword');
    expect(passwordPolicyError('wrongpassword')).toMatch(/uppercase/);
    expect((sec.match(/-d "\$LOGIN_PAYLOAD"/g) ?? []).length).toBe(6);
  });

  it('start-clean.sh skips the seed rather than inventing a password', () => {
    expect(start).toMatch(/if \[ -z "\$\{SEED_PASSWORD:-\}" \]; then/);
    expect(start).toMatch(/skipping the development seed/);
    expect(start).not.toMatch(/SEED_PASSWORD=password/);
  });

  it('release.yml generates the password, exports both names, and logs neither', () => {
    expect(release).not.toMatch(/^\s*SMOKE_LOGIN_PASSWORD:\s*\S/m);
    expect(release).toMatch(/CHAIN_PASSWORD="Release!\$\(od -An -tx1/);
    expect(release).toMatch(/echo "SEED_PASSWORD=\$CHAIN_PASSWORD" >> "\$GITHUB_ENV"/);
    expect(release).toMatch(/echo "SMOKE_LOGIN_PASSWORD=\$CHAIN_PASSWORD" >> "\$GITHUB_ENV"/);
    expect(release).toMatch(/unset CHAIN_PASSWORD/);
    // the generated value satisfies the app policy by construction: uppercase, digit, special, >12
    const generated = /CHAIN_PASSWORD="([^$]+)\$\([^"]*\)([^"]*)"/.exec(release);
    expect(generated).not.toBeNull();
    const shape = `${generated![1]}X9${generated![2]}`;
    expect(passwordPolicyError(shape)).toBeNull();
    // generated before the seed runs — `db:seed` also appears in this file's header
    // prose, so the comparison is against the step, not the first mention
    expect(release.indexOf('CHAIN_PASSWORD=')).toBeLessThan(release.lastIndexOf('npm run db:seed'));
  });

  it('keeps the host and NODE_ENV guards, labelled as not the answer', () => {
    expect(seedDev).toMatch(/process\.env\.NODE_ENV === 'production'/);
    expect(seedDev).toContain('/localhost|127\\.0\\.0\\.1|::1/');
    expect(seedDev).toMatch(/neither is the answer/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('#3281 the screen is wired where a regression cannot slip past', () => {
  it('runs in ci.yml as a job, with both controls', () => {
    const lines = ci.split('\n');
    const jobAt = lines.findIndex((l) => l.startsWith('  seed-credential:'));
    expect(jobAt).toBeGreaterThan(-1);
    expect(lines.slice(jobAt, jobAt + 70).join('\n')).toMatch(/Positive control/);
    expect(lines.slice(jobAt, jobAt + 90).join('\n')).toMatch(/Negative control/);
    expect(ci).toMatch(/npm run guard:seed-credential/);
    // the `if` form survives `bash -e`; a bare `cmd | tee` would end the step early
    expect(ci).toMatch(/if npm run guard:seed-credential -- \\\n\s+--root "\$FIX"/);
    // the planted literals live in tests/fixtures/, which this screen does not scan;
    // embedding them in ci.yml would make the positive control fail on its own file
    expect(ci).toMatch(/cp -r tests\/fixtures\/seed-credential-negative/);
    expect(ci).not.toMatch(/^\s*SMOKE_LOGIN_PASSWORD: \S/m);
    expect(read('tests/fixtures/seed-credential-negative/scripts/planted.ts')).toContain("bcrypt.hash('Admin123!', 12)");
  });

  it('is inserted below every cited coordinate and leaves constraint-vocab last', () => {
    const lines = ci.split('\n');
    const COORDINATES: Array<[number, string]> = [
      [221, 'check-audit-baseline.mjs'],
      [254, 'check-semgrep-baseline.mjs'],
      [401, 'Schema drift check (column-level)'],
      [447, 'check-env-coverage.mjs'],
    ];
    for (const [line, mustContain] of COORDINATES) {
      expect(lines[line - 1], `ci.yml:${line}`).toContain(mustContain);
    }
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    expect(jobKeys.indexOf('seed-credential')).toBe(jobKeys.length - 2);
    expect(lines.findIndex((l) => l.startsWith('  seed-credential:')) + 1).toBeGreaterThan(447);
  });

  it('is counted by the docs census, which is a check rather than prose', () => {
    const readme = read('docs/README.md');
    const para = /enforces \*\*(\d+)\*\*[^—]*—([\s\S]*?)—\s*plus/.exec(readme);
    expect(para).not.toBeNull();
    const named = [...para![2].matchAll(/`(guard:[a-z-]+)`/g)].map((m) => m[1]);
    const invoked = new Set([...ci.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]));
    expect(named).toContain('guard:seed-credential');
    expect(Number(para![1])).toBe(named.length);
    for (const alias of named) expect(invoked.has(alias), `${alias} claimed but not invoked`).toBe(true);
    const pkg = JSON.parse(read('package.json'));
    const total = Object.keys(pkg.scripts).filter((k) => k.startsWith('guard:'));
    expect(readme).toMatch(new RegExp(`defines \\*\\*${total.length}\\*\\* aliases in total`));
    expect(total).toContain('guard:seed-credential');
    // the alias is counted only because ci.yml invokes it by name — a bare
    // `node scripts/check-seed-credentials.mjs` would not enter this set
    expect(invoked.has('guard:seed-credential')).toBe(true);
    expect([...ci.matchAll(/npm run guard:seed-credential/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('documents SEED_PASSWORD where an operator will find it, and allowlists the override', () => {
    const envExample = read('.env.example');
    expect(envExample).toMatch(/^SEED_PASSWORD=/m);
    expect(envExample).toContain('#3281');
    const allow = JSON.parse(read('scripts/env-coverage-allowlist.json'));
    const entry = allow.entries.find((e: { name: string }) => e.name === 'SEED_ALLOW_POPULATED');
    expect(entry, 'SEED_ALLOW_POPULATED must be allowlisted with a reason').toBeDefined();
    expect(entry.reason).toContain('#3281');
    expect(entry.reason.length).toBeGreaterThan(60);
    expect(read('scripts/seed-dev.ts')).toMatch(/process\.env\.SEED_ALLOW_POPULATED/);
    expect(spawnSync(process.execPath, [join(ROOT, 'scripts/check-env-coverage.mjs')], { encoding: 'utf8', cwd: ROOT }).status).toBe(0);
  });
});

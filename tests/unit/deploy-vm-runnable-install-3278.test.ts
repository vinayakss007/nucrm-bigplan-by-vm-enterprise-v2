/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3278 — `scripts/deploy-vm.sh` was the documented VM auto-deploy and could not
 * produce a running install: it cloned a DIFFERENT repository, never started
 * anything on :3000, read `curl` exit 0 as success (so a 403 from the one-shot
 * setup gate printed `=== Done ===` while the platform super admin, which
 * `app/api/setup/create-admin/route.ts` refuses to create twice, was never
 * created), and wrote the Postgres superuser password into a 0644 file.
 *
 * The rewrite's whole claim is that every step is either checked or exits
 * non-zero, so this file runs the two modes that are checkable without a spare
 * VM — `--dry-run` and `--env-only` — and asserts on what actually happened:
 * exit codes, the mode of the file, the key set and lengths the app validates at
 * boot, the order of the sequence, that no credential reaches stdout, and that the
 * run left no file behind. The rest pin structural claims a dry run cannot show
 * (where the env file lands relative to the checkout, which helper is invoked how).
 *
 * NOT claimed here, because nothing in this repo can measure it: the install has
 * not been run end to end on a clean host. `--dry-run` proves the sequence and the
 * guards; it does not prove that `dnf install nodejs` produces 22.23.4 on a given
 * stream, or that an operator's proxy serves /api/health. That residue is named in
 * the comment at the bottom of this file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/deploy-vm.sh');

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vm3278-deploy-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Values only this test knows, so "no secret on stdout" is measurable. */
const INJECTED = {
  APP_URL: 'https://crm.example.com',
  ADMIN_EMAIL: 'ops@example.com',
  ADMIN_PASSWORD: 'Str0ng!Passw0rd-x',
  JWT_SECRET: 'vm3278injJwt000000000000000000000000000000000000000',
  SESSION_SECRET: 'vm3278injSession00000000000000000000000000000000000',
  ENCRYPTION_KEY: 'vm3278injEncryption00000000000000000000000000000000',
  SETUP_KEY: 'vm3278injSetup000000000000000000000000000000000000',
  CRON_SECRET: 'vm3278injCron0000000000000000000000000000000000000000',
  EMERGENCY_RECOVERY_KEY: 'vm3278injRecovery000000000000000000000000000000000000',
  METRICS_SECRET: 'vm3278injMetrics0000000000000000000000000000000000000000',
  APP_DB_PASSWORD: 'vm3278injAppDb000000000000000000000000000000000',
  OWNER_DB_PASSWORD: 'vm3278injOwnerDb00000000000000000000000000000000',
};

type Run = { status: number | null; out: string; err: string };

function spawn(args: string[], env: Record<string, string | undefined>): Run {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, err: r.stderr ?? '' };
}

function deploy(args: string[], env: Record<string, string> = {}): Run {
  return spawn(args, { APP_DIR: dir, ...INJECTED, ...env });
}

/** The same run with nothing injected, so what is measured is what openssl made. */
function deployGenerated(args: string[], env: Record<string, string> = {}): Run {
  const cleared: Record<string, string | undefined> = { APP_DIR: dir };
  for (const [name, value] of Object.entries(INJECTED)) {
    cleared[name] = ['APP_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].includes(name) ? value : undefined;
  }
  return spawn(args, { ...cleared, ...env });
}

/** The keys scripts/assert-runtime-env.mjs enumerates as required at runtime. */
const REQUIRED_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_APP_URL',
  'ALLOWED_ORIGINS',
  'COOKIE_SECURE',
  'TRUST_PROXY',
  'DATABASE_URL',
  'DATABASE_SSL',
  'DATABASE_SSL_REJECT_UNAUTHORIZED',
  'SETUP_KEY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'CRON_SECRET',
  'ENCRYPTION_KEY',
  'EMERGENCY_RECOVERY_KEY',
  'METRICS_SECRET',
];

/** lib/env.ts:3 bits/char separates real random secrets from low-entropy ones. */
function bitsPerChar(value: string): number {
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const parse = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

/** A host with no supported package manager cannot run the full sequence. */
const HAS_PKG =
  spawnSync('bash', ['-c', 'command -v apt-get || command -v dnf || command -v yum'], {
    encoding: 'utf8',
  }).status === 0;

describe('deploy-vm.sh --env-only writes the file the app will accept', () => {
  const target = () => join(dir, 'preview.env');
  let run: Run = { status: null, out: '', err: '' };
  let keys: Record<string, string> = {};

  beforeAll(() => {
    rmSync(target(), { force: true });
    run = deploy(['--env-only', target()]);
    keys = parse(readFileSync(target(), 'utf8'));
  });

  it('exits 0 on a host with no Postgres, no sudo use and no clone', () => {
    expect(run.status).toBe(0);
    expect(run.out).not.toMatch(/FATAL/);
  });

  it('is mode 600, not the 0644 the old script shipped', () => {
    expect((statSync(target()).mode & 0o777).toString(8)).toBe('600');
  });

  it('carries every key assert-runtime-env.mjs reads at runtime', () => {
    const missing = REQUIRED_KEYS.filter((k) => keys[k] === undefined);
    expect(missing, `missing from the env file: ${missing.join(', ')}`).toEqual([]);
  });

  it('pairs sslmode with DATABASE_SSL instead of asserting one', () => {
    // deploy/.env.production's own note and LAUNCH_RUNBOOK §4: the two must agree.
    const mode = /sslmode=([a-z-]+)/.exec(keys.DATABASE_URL)?.[1];
    expect(mode).toBe('require');
    expect(keys.DATABASE_SSL).toBe('true');
  });

  it('sets the production defaults the fail-closed code paths key off', () => {
    // #3279: NODE_ENV unset selected every dev default — cookie-Secure forcing,
    // the SETUP_KEY gate and demo gating all read it.
    expect(keys.NODE_ENV).toBe('production');
    expect(keys.TRUST_PROXY).toBe('true');
    expect(keys.COOKIE_SECURE).toBe('true');
    // Stated deliberately rather than left unset: anything but true/false reads
    // as false, and a TRANSACTION-mode pooler leaks app.* RLS GUCs (lib/db/pool.ts).
    expect(keys.PGBOUNCER_ENABLED).toBe('false');
  });

  it('clears lib/env.ts floors for the secrets it generates itself', () => {
    // Not the injected ones above: this measures what openssl rand produced, which
    // is what runs on a real VM.
    const generated = join(dir, 'generated.env');
    expect(deployGenerated(['--env-only', generated]).status).toBe(0);
    const made = parse(readFileSync(generated, 'utf8'));
    const lengths = {
      JWT_SECRET: made.JWT_SECRET.length,
      SESSION_SECRET: made.SESSION_SECRET.length,
      CRON_SECRET: made.CRON_SECRET.length,
      ENCRYPTION_KEY: made.ENCRYPTION_KEY.length,
      SETUP_KEY: made.SETUP_KEY.length,
    };
    for (const [name, n] of Object.entries(lengths)) {
      expect(n, `${name} is shorter than lib/env.ts requires`).toBeGreaterThanOrEqual(name === 'SETUP_KEY' ? 20 : 32);
    }
    for (const name of ['JWT_SECRET', 'SESSION_SECRET', 'CRON_SECRET', 'ENCRYPTION_KEY', 'EMERGENCY_RECOVERY_KEY', 'METRICS_SECRET']) {
      expect(bitsPerChar(made[name]), `${name} is below 3 bits/char`).toBeGreaterThanOrEqual(3);
    }
  });

  it('prints the path and the mode, and no value', () => {
    for (const value of Object.values(INJECTED)) expect(run.out).not.toContain(value);
    expect(run.out).toMatch(/mode 600/);
  });

  it('defaults the file into the repo, where pm2 and Next actually read it', () => {
    // ecosystem.config.cjs sets `cwd: __dirname` and parses `${__dirname}
    // /.env.local`; scripts/load-env.mjs resolves the same path. A file in the
    // parent directory is invisible to all three.
    expect(run.out).toContain(join(dir, 'repo', '.env.local'));
  });

  it('falls back to an unsecured-cookie reading for a non-https APP_URL, loudly', () => {
    const http = deploy(['--env-only', join(dir, 'http.env')], { APP_URL: 'http://198.51.100.7' });
    expect(http.status).toBe(0);
    expect(http.out).toMatch(/WARNING.*not https/);
    expect(parse(readFileSync(join(dir, 'http.env'), 'utf8')).COOKIE_SECURE).toBe('false');
  });
});

describe('deploy-vm.sh --dry-run proves the sequence without touching the host', () => {
  it.skipIf(!HAS_PKG)('runs nothing and exits 0', () => {
    const empty = join(dir, 'sandbox');
    const r = deploy(['--dry-run'], { APP_DIR: empty });
    expect(r.status).toBe(0);
    // Every side effect is printed as [dry-run]; nothing is created.
    expect(existsSync(empty)).toBe(false);
    expect(r.out).not.toMatch(/FATAL/);
  });

  it.skipIf(!HAS_PKG)('never leaks a credential into shareable output', () => {
    const r = deploy(['--dry-run'], { APP_DIR: join(dir, 'sandbox2') });
    for (const value of Object.values(INJECTED)) {
      if (value === INJECTED.APP_URL || value === INJECTED.ADMIN_EMAIL) continue;
      expect(r.out, `${value.slice(0, 12)}… reached stdout`).not.toContain(value);
    }
    expect(r.out).toMatch(/DATABASE_URL='<owner>'/);
  });

  it.skipIf(!HAS_PKG)('orders the install so the env file follows the checkout', () => {
    const r = deploy(['--dry-run'], { APP_DIR: join(dir, 'sandbox3') });
    const step = (re: RegExp) => r.out.split('\n').findIndex((l) => re.test(l));
    const clone = step(/git clone/);
    const env = step(/write .*\/repo\/\.env\.local/);
    const provision = step(/provision-app-role\.mjs/);
    const migrate = step(/npm run db:migrate -- --yes/);
    const gate = step(/node scripts\/assert-runtime-env\.mjs --expect-production/);
    const build = step(/npm run build/);
    const start = step(/pm2 start ecosystem\.config\.cjs --update-env/);
    expect([clone, env, provision, migrate, gate, build, start]).toEqual(
      [clone, env, provision, migrate, gate, build, start].slice().sort((a, b) => a - b),
    );
    // git clone refuses a non-empty directory: writing the env file first would
    // make a fresh install fail on the step that has to fetch the code.
    expect(clone).toBeLessThan(env);
    // …and the build must follow the file, because next build inlines NEXT_PUBLIC_*.
    expect(env).toBeLessThan(build);
  });

  it.skipIf(!HAS_PKG)('starts all three pm2 apps, not a lone front end', () => {
    const r = deploy(['--dry-run'], { APP_DIR: join(dir, 'sandbox4') });
    expect(r.out).toMatch(/pm2 start ecosystem\.config\.cjs --update-env/);
    expect(r.out).not.toMatch(/--only web/);
  });

  it('refuses a plaintext data tier rather than writing a contradictory pair', () => {
    // All three pm2 apps pin DATABASE_SSL=true; pg's ssl option beats the
    // connection string's sslmode, so sslmode=disable here is a restart loop.
    const r = deploy(['--dry-run', '--no-build'], { NUCRM_DB_SSL: 'off', APP_DIR: join(dir, 'sandbox5') });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/FATAL.*ssl=off/);
    expect(r.err).toMatch(/DATABASE_SSL=true/);
  });

  it('refuses a remote DB_HOST it cannot ask about TLS', () => {
    // sudo -u postgres psql answers for the local cluster only. Guessing from
    // that would be asserting the sslmode — the thing this section exists to stop.
    const r = deploy(['--dry-run', '--no-build'], { DB_HOST: '198.51.100.9', APP_DIR: join(dir, 'sandbox7') });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/is not this host/);
    expect(r.err).toMatch(/NUCRM_DB_SSL=on/);
  });

  it('accepts a remote data tier the operator has stated is TLS', () => {
    const target = join(dir, 'remote.env');
    const r = deploy(['--env-only', target], { DB_HOST: 'db.internal.example', NUCRM_DB_SSL: 'on' });
    expect(r.status).toBe(0);
    const made = parse(readFileSync(target, 'utf8'));
    expect(made.DATABASE_URL).toContain('@db.internal.example:5432/nucrm_db?sslmode=require');
    expect(made.DATABASE_SSL).toBe('true');
  });

  it('stops before build and start with --no-build', () => {
    const r = deploy(['--dry-run', '--no-build'], { APP_DIR: join(dir, 'sandbox6') });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/npm run db:migrate/);
    expect(r.out).not.toMatch(/npm run build/);
    expect(r.out).not.toMatch(/pm2 start/);
    expect(r.out).toMatch(/--no-build: stopping before build and start/);
  });
});

describe('deploy-vm.sh fails closed on the operator path', () => {
  it('unknown argument is usage, not a partial run', () => {
    const r = deploy(['--nonsense']);
    expect(r.status).toBe(2);
    expect(r.err).toMatch(/unknown argument/);
  });

  it('a missing APP_URL stops before anything else', () => {
    const { APP_URL: _omit, ...rest } = INJECTED;
    const r = spawn(['--env-only', join(dir, 'no-app-url.env')], { APP_DIR: dir, APP_URL: undefined, ...rest });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/APP_URL is required/);
    expect(existsSync(join(dir, 'no-app-url.env'))).toBe(false);
  });

  it('missing admin credentials stop the run before the first side effect', () => {
    // #3278's own review point: discovering the password is missing after the
    // clone, the role and the migrations leaves an install nobody can undo.
    const src = readFileSync(SCRIPT, 'utf8');
    const lines = src.split('\n');
    const guard = lines.findIndex((l) => /ADMIN_PASSWORD=\$\{ADMIN_PASSWORD:/.test(l));
    const envWrite = lines.findIndex((l) => /cat >"\$ENV_TARGET"/.test(l));
    const clone = lines.findIndex((l) => /git clone/.test(l));
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(envWrite);
    expect(guard).toBeLessThan(clone);
    expect(lines[guard]).toMatch(/8/);
    expect(lines[guard]).toMatch(/12/);

    const { ADMIN_PASSWORD: _omit, ...rest } = INJECTED;
    const res = spawn(['--env-only', join(dir, 'no-admin.env')], { APP_DIR: dir, ADMIN_PASSWORD: undefined, ...rest });
    expect(res.status).toBe(1);
    expect(existsSync(join(dir, 'no-admin.env'))).toBe(false);
  });

  it('the health gate cannot be satisfied by a curl that never connected', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    // http_code, captured and compared — `curl …; if [ $? -eq 0 ]` is the bug.
    expect(src).toMatch(/-w '%\{http_code\}'/);
    expect(src).toMatch(/if \[ "\$code" = 200 \]/);
    expect(src).toMatch(/case "\$code" in/);
    // The die says the setup endpoint has NOT been called, which is what makes
    // re-running safe against a one-shot bootstrap.
    expect(src).toMatch(/never answered 200[\s\S]{0,300}setup endpoint has not been called/);
  });

  it('classifies a status code, not a curl exit status — including when curl fails', () => {
    // Measured against a local server: `code=$(curl … -w '%{http_code}' … || echo 000)`
    // yields "404000" and "000000", because -w has already printed when the ||
    // branch runs. A two-line $code never equals 200 (so the loop is still correct)
    // but it also never matches the `000)` arm of the case, which is the one that
    // tells the operator the public edge is missing rather than the app.
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src, 'a curl fallback echoing inside the substitution').not.toMatch(/\|\| echo 000\s*\)/);
    const captures = src.match(/\) \|\| code=000/g) ?? [];
    expect(captures, 'curl call sites that do not capture their status with `) || code=000`').toHaveLength(2);
    // No -f on either probe: it turns an HTTP 4xx into a shell failure.
    expect(src).not.toMatch(/curl [^\n]*-f[^\n]*'%\{http_code\}'/);
  });

  it('invokes the two .mjs database helpers through tsx, not node', () => {
    // provision-app-role.mjs and check-db-role-privileges.mjs both import
    // lib/db/*.ts; `node scripts/check-db-role-privileges.mjs` cannot load them.
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/npx tsx scripts\/provision-app-role\.mjs/);
    expect(src).toMatch(/npx tsx scripts\/check-db-role-privileges\.mjs/);
    expect(src).not.toMatch(/\bnode scripts\/check-db-role-privileges\.mjs/);
  });

  it('migrates through the chain, never the push shortcut', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/npm run db:migrate -- --yes/);
    // AGENTS.md: db:sync is drizzle-kit push — no policies, no functions, no
    // ledger. The word appears in this script only as the thing it refuses.
    expect(src).not.toMatch(/run db:sync/);
  });

  it('leaves a --dry-run sandbox empty', () => {
    const made = [2, 3, 4, 5, 6].filter((n) => existsSync(join(dir, `sandbox${n}`)) && readdirSync(join(dir, `sandbox${n}`)).length > 0);
    expect(made, `dry-run created files in ${made.join(', ')}`).toEqual([]);
  });
});

describe('dry-run touches nothing', () => {
  // A dry run that mkdir's, clones or writes is one an operator cannot review
  // safely on the box they are about to install on. Every --dry-run above pointed
  // APP_DIR at a fresh sandbox subdirectory; none of them may exist now, and the
  // temp dir may hold only the env files --env-only was explicitly told to write.
  it('creates no sandbox directory at all', () => {
    expect(readdirSync(dir).filter((f) => f.startsWith('sandbox'))).toEqual([]);
  });
});

/*
 * Residue named, not fixed — three claims need a spare VM, and no unit test can
 * substitute for them: (1) that the distro's node stream really reaches 22.23.4
 * (the script checks and dies, but the check is only as good as the repo behind
 * it); (2) that a packaging default pg_hba lets nucrm_app authenticate over TCP
 * with scram; (3) that /api/health answers 200 through the operator's proxy.
 */

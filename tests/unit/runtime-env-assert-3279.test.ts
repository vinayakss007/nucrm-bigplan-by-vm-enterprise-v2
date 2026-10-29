/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3279 ask 2 — assert the fail-closed flags against the environment the SERVER
 * PROCESS actually has, not against whichever template somebody copied.
 *
 * Three independently-sourced defaults encode the same decision (`deploy/
 * .env.production`, `.env.example`, `ecosystem.config.cjs`) and only one of them
 * reaches a running pm2 worker: pm2 replays the environment it captured at first
 * `start`, and dotenv/Next.js fills only names that are still unset, so a file edit
 * can be true on disk and absent in every worker. `getClientIp()` then answers
 * `'unknown'` (`lib/client-ip.ts:15`), `checkRateLimit` fails closed with 503 for
 * auth-scoped actions (`lib/rate-limit.ts:442`, #2630) and the install is born
 * unable to log in while blaming the caller. The only reading that means anything is
 * the process's, so that is what this asserts, and the comparison itself is a pure
 * function over an injected env map so it needs no live server, no database and no
 * pm2 — which is also the honest limit of what can be reached from this repo's
 * runtime (see the source-resolution tests at the bottom).
 *
 * Fixture values are placeholders throughout: this repo is public, so no IP, host or
 * credential appears in it, and `CRON_ALLOWED_IPS` fixtures are deliberately
 * not-address-shaped because the rule keys on presence, not on the value's format.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'assert-runtime-env.mjs');

type Row = {
  name: string;
  value: string;
  expected: string;
  status: 'ok' | 'warn' | 'fail';
  note: string;
};

type AssertModule = {
  REQUIRED_RUNTIME_FLAGS: { name: string }[];
  TEMPLATE_SECURITY_FLAGS: { name: string }[];
  checkRuntimeFlags: (
    env: Record<string, string | undefined>,
    opts?: { expectProduction?: boolean; trustProxyOptional?: boolean },
  ) => Row[];
  parseEnvFile: (text: string) => Record<string, string>;
  parseProcEnviron: (text: string) => Record<string, string>;
  nextAppEnv: (config: unknown) => { label: string; env: Record<string, string> };
  resolveEffectiveEnv: (deps: {
    argv: string[];
    shellEnv: Record<string, string | undefined>;
    readFile: (p: string) => string | null;
    readProcEnviron?: (pid: string) => string | null;
    runCommand?: (cmd: string, args: string[]) => string | null;
    loadEcosystem?: () => unknown;
    envFileCandidates?: string[];
  }) => { env: Record<string, string | undefined>; source: string };
  valueIsUnfilledTemplateToken: (value: string) => boolean;
  assertRuntimeEnv: (deps: Parameters<AssertModule['resolveEffectiveEnv']>[0] & {
    argv: string[];
  }) => { rows: Row[]; source: string; failures: number; warnings: number };
};

async function mod(): Promise<AssertModule> {
  return (await import(SCRIPT)) as AssertModule;
}

const row = (rows: Row[], name: string) => rows.find((r) => r.name === name);
const failed = (rows: Row[]) => rows.filter((r) => r.status === 'fail').map((r) => r.name);

/** A production environment that is configured correctly, as the baseline to perturb. */
const GOOD: Record<string, string> = {
  NODE_ENV: 'production',
  TRUST_PROXY: 'true',
  COOKIE_SECURE: 'true',
  DATABASE_SSL: 'true',
  SETUP_KEY: 'a-generated-placeholder-value-not-a-real-key',
  JWT_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  SESSION_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  CRON_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  ENCRYPTION_KEY: 'a-generated-placeholder-value-not-a-real-key',
  NEXT_PUBLIC_APP_URL: 'https://crm.example.com',
  ALLOWED_ORIGINS: 'https://crm.example.com',
};

function cli(
  args: string[],
  env: Record<string, string> = {},
): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // A minimal, explicit environment: inheriting this shell's would let a stray
    // TRUST_PROXY/NODE_ENV here decide the exit code the test is asserting on.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

describe('the fail-closed flag table', () => {
  it('covers every name the templates are held to, so the table and the files cannot drift', async () => {
    const m = await mod();
    const asserted = m.REQUIRED_RUNTIME_FLAGS.map((f) => f.name);
    const documented = m.TEMPLATE_SECURITY_FLAGS.map((f) => f.name);
    const missing = asserted.filter((n) => !documented.includes(n));
    expect(missing).toEqual([]);
    expect(asserted.length).toBeGreaterThanOrEqual(8);
  });

  it('checks the template list is not a superset of the flags it asserts', async () => {
    const m = await mod();
    const asserted = m.REQUIRED_RUNTIME_FLAGS.map((f) => f.name);
    // `compare: false` is the documented meaning of "this name is held equal across
    // the two templates but is not a fail-closed rule" — DATABASE_URL, whose host,
    // role and password differ per topology and which #2302 forbids printing.
    const documented = m.TEMPLATE_SECURITY_FLAGS.filter((f) => f.compare !== false).map((f) => f.name);
    const extra = documented.filter((n) => !asserted.includes(n));
    expect(extra).toEqual([]);
  });

  it('names TRUST_PROXY in it, because that is the flag #3279 cost hours on', async () => {
    const m = await mod();
    expect(m.REQUIRED_RUNTIME_FLAGS.map((f) => f.name)).toContain('TRUST_PROXY');
  });
});

describe('checking a production process environment', () => {
  it('fails and says expected versus effective when TRUST_PROXY is false', async () => {
    const rows = (await mod()).checkRuntimeFlags({ ...GOOD, TRUST_PROXY: 'false' });
    const r = row(rows, 'TRUST_PROXY');
    expect(r?.status).toBe('fail');
    expect(r?.expected).toBe('true');
    expect(r?.value).toBe('false');
  });

  it('treats an absent TRUST_PROXY exactly like false, since the code tests for the string true', async () => {
    const env = { ...GOOD } as Record<string, string | undefined>;
    delete env.TRUST_PROXY;
    const rows = (await mod()).checkRuntimeFlags(env);
    expect(row(rows, 'TRUST_PROXY')?.status).toBe('fail');
    expect(row(rows, 'TRUST_PROXY')?.value).toBe('(unset)');
  });

  it('accepts a production process that really does sit behind a proxy', async () => {
    const rows = (await mod()).checkRuntimeFlags(GOOD);
    expect(failed(rows)).toEqual([]);
  });

  it('does not demand TRUST_PROXY from a development box, where refusing to trust headers is correct', async () => {
    const rows = (await mod()).checkRuntimeFlags({ NODE_ENV: 'development', TRUST_PROXY: 'false' });
    expect(failed(rows)).toEqual([]);
  });

  it('warns instead of failing when a proxy-less platform terminates TLS upstream', async () => {
    const m = await mod();
    const env = { ...GOOD } as Record<string, string | undefined>;
    delete env.TRUST_PROXY;
    expect(failed(m.checkRuntimeFlags(env))).toContain('TRUST_PROXY');
    const rows = m.checkRuntimeFlags(env, { trustProxyOptional: true });
    expect(row(rows, 'TRUST_PROXY')?.status).toBe('warn');
    expect(failed(rows)).not.toContain('TRUST_PROXY');
  });

  it('fails an IP allowlist that can only deny everything without a trusted proxy', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      TRUST_PROXY: 'false',
      CRON_ALLOWED_IPS: 'set-by-the-operator',
    });
    expect(row(rows, 'CRON_ALLOWED_IPS')?.status).toBe('fail');
    expect(row(rows, 'CRON_ALLOWED_IPS')?.expected).toContain('TRUST_PROXY=true');
  });

  it('warns that CRON_SIGNING_KEY is an off switch, and reports its shape not its value', async () => {
    // #3271's boot audit carried this finding; the folded CLI has to keep it, or
    // deleting the second script would have silently dropped an assertion that an
    // operator can read.
    const secret = 'a-live-hmac-key-value';
    const rows = (await mod()).checkRuntimeFlags({ ...GOOD, CRON_SIGNING_KEY: secret });
    const r = row(rows, 'CRON_SIGNING_KEY');
    expect(r?.status).toBe('warn');
    expect(r?.value).toBe('(set)');
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(r?.note).toMatch(/#3298/);
  });

  it('fails a cookie that would ship unencrypted, and accepts the fail-closed default of unset', async () => {
    const m = await mod();
    expect(row(m.checkRuntimeFlags({ ...GOOD, COOKIE_SECURE: 'false' }), 'COOKIE_SECURE')?.status).toBe(
      'fail',
    );
    const env = { ...GOOD } as Record<string, string | undefined>;
    delete env.COOKIE_SECURE;
    expect(failed(m.checkRuntimeFlags(env))).not.toContain('COOKIE_SECURE');
  });

  it('fails a RESEND_TEST_MODE that would mock every production email silently', async () => {
    const rows = (await mod()).checkRuntimeFlags({ ...GOOD, RESEND_TEST_MODE: 'true' });
    expect(row(rows, 'RESEND_TEST_MODE')?.status).toBe('fail');
  });

  it('fails an origin left on the localhost default, which is what the browser is actually told', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    expect(failed(rows)).toEqual(expect.arrayContaining(['NEXT_PUBLIC_APP_URL', 'ALLOWED_ORIGINS']));
  });

  it('fails a published template placeholder in a credential, because a known key is not a gap', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      SETUP_KEY: '<<<REQUIRED>>>',
      JWT_SECRET: '<<<REQUIRED>>>',
    });
    expect(row(rows, 'SETUP_KEY')?.status).toBe('fail');
    expect(row(rows, 'JWT_SECRET')?.status).toBe('fail');
    expect(failed(rows)).toEqual(expect.arrayContaining(['SETUP_KEY', 'JWT_SECRET']));
  });

  it('only warns about an empty SETUP_KEY, since the endpoint already refuses without one', async () => {
    const env = { ...GOOD } as Record<string, string | undefined>;
    env.SETUP_KEY = '';
    const rows = (await mod()).checkRuntimeFlags(env);
    expect(row(rows, 'SETUP_KEY')?.status).toBe('warn');
  });

  it('recognises the sslmode contradiction the production template warns about in its own comment', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      DATABASE_SSL: 'true',
      DATABASE_URL: 'postgresql://nucrm:<<<PW>>>@db.internal:5432/nucrm?sslmode=disable',
    });
    expect(row(rows, 'DATABASE_SSL')?.status).toBe('fail');
  });

  it('warns about the reverse direction, which PgBouncer makes legitimate', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      DATABASE_SSL: 'false',
      DATABASE_URL: 'postgresql://nucrm:<<<PW>>>@db.internal:5432/nucrm?sslmode=require',
    });
    expect(row(rows, 'DATABASE_SSL')?.status).toBe('warn');
    expect(failed(rows)).not.toContain('DATABASE_SSL');
  });

  it('never prints the connection string it reasoned about', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      ...GOOD,
      DATABASE_SSL: 'true',
      DATABASE_URL: 'postgresql://nucrm:<<<PW>>>@db.internal:5432/nucrm?sslmode=disable',
    });
    const printed = JSON.stringify(rows);
    expect(printed).not.toContain('db.internal');
    expect(printed).not.toContain('://');
    expect(printed).not.toContain('<<<PW>>>');
  });

  it('names every variable it failed on with what it expected, not just a count', async () => {
    const rows = (await mod()).checkRuntimeFlags({
      NODE_ENV: 'production',
      TRUST_PROXY: 'false',
      COOKIE_SECURE: 'false',
    });
    const fails = rows.filter((r) => r.status === 'fail');
    expect(fails.length).toBeGreaterThanOrEqual(2);
    for (const r of fails) {
      expect(r.name).toMatch(/^[A-Z0-9_]+$/);
      expect(r.expected.length).toBeGreaterThan(0);
      expect(r.note.length).toBeGreaterThan(0);
    }
  });
});

describe('reading an environment from wherever it is reachable', () => {
  it('parses an env file, including quoted and comment-tail values', async () => {
    const m = await mod();
    expect(m.parseEnvFile('A=1\n#B=2\nC=three # trailing\n\nD=\n')).toEqual({
      A: '1',
      C: 'three',
      D: '',
    });
  });

  it('parses /proc/<pid>/environ, the one reading that shows what pm2 replayed', async () => {
    const m = await mod();
    expect(m.parseProcEnviron('A=1\0B=2\0C=\0')).toEqual({ A: '1', B: '2', C: '' });
  });

  it('prefers the live process environment over the shell it was called from', async () => {
    const m = await mod();
    const { env, source } = m.resolveEffectiveEnv({
      argv: ['--pid', '4242'],
      shellEnv: { TRUST_PROXY: 'false' },
      readFile: () => null,
      readProcEnviron: (pid) => (pid === '4242' ? 'TRUST_PROXY=true\0NODE_ENV=production\0' : null),
    });
    expect(env.TRUST_PROXY).toBe('true');
    expect(source).toContain('/proc/4242/environ');
  });

  it('puts the ecosystem env block above the shell, the way pm2 builds a worker environment', async () => {
    const m = await mod();
    const config = {
      apps: [
        { name: 'worker', script: 'node_modules/.bin/tsx', env: { TRUST_PROXY: 'false' } },
        { name: 'web', script: 'node_modules/.bin/next', env: { TRUST_PROXY: 'true', NODE_ENV: 'production' } },
      ],
    };
    expect(m.nextAppEnv(config).label).toContain('web');
    const { env } = m.resolveEffectiveEnv({
      argv: [],
      shellEnv: { TRUST_PROXY: 'false', COOKIE_SECURE: 'true' },
      readFile: () => null,
      loadEcosystem: () => config,
    });
    expect(env.TRUST_PROXY).toBe('true');
    expect(env.COOKIE_SECURE).toBe('true');
  });

  it('lets the operator env file fill only the gaps, because dotenv never overwrites a set name', async () => {
    const m = await mod();
    const fileEnv = 'COOKIE_SECURE=true\nTRUST_PROXY=true\n';
    const merged = m.resolveEffectiveEnv({
      argv: [],
      shellEnv: { TRUST_PROXY: 'false' },
      readFile: () => fileEnv,
      loadEcosystem: () => ({ apps: [] }),
      envFileCandidates: ['.env.local', '.env'],
    });
    expect(merged.env.COOKIE_SECURE).toBe('true');
    // The process already had false (pm2 replayed it), so the file's true is inert.
    // This is the exact trap #3279 describes, so it must survive the merge.
    expect(merged.env.TRUST_PROXY).toBe('false');
    expect(merged.source).toContain('.env.local');
  });

  it('reads only its own process when told the caller is the container', async () => {
    const m = await mod();
    const { env, source } = m.resolveEffectiveEnv({
      argv: ['--process-only'],
      shellEnv: { TRUST_PROXY: 'false' },
      readFile: () => 'TRUST_PROXY=true\n',
      loadEcosystem: () => ({ apps: [{ name: 'web', script: 'next', env: { TRUST_PROXY: 'true' } }] }),
    });
    expect(env.TRUST_PROXY).toBe('false');
    expect(source).toContain('process.env');
  });

  it('calls a source it cannot read an error rather than a pass', async () => {
    const m = await mod();
    expect(() =>
      m.resolveEffectiveEnv({
        argv: ['--pm2', 'web'],
        shellEnv: {},
        readFile: () => null,
        runCommand: () => null, // pm2 not installed, exactly the state of this box
      }),
    ).toThrow(/pm2/i);
  });

  it('accepts the pm2 environment when pm2 is there to answer', async () => {
    const m = await mod();
    const { env, source } = m.resolveEffectiveEnv({
      argv: ['--pm2', 'web'],
      shellEnv: { TRUST_PROXY: 'false' },
      readFile: () => null,
      runCommand: () => JSON.stringify([{ name: 'web', pm2_env: { TRUST_PROXY: 'true', NODE_ENV: 'production' } }]),
    });
    expect(env.TRUST_PROXY).toBe('true');
    expect(source).toContain('pm2');
  });
});

describe('the command an operator runs', () => {
  it('exits non-zero and names TRUST_PROXY when the live env cannot authenticate anyone', () => {
    const { code, out } = cli(['--expect-production', '--process-only'], {
      ...GOOD,
      TRUST_PROXY: 'false',
    });
    expect(code).toBe(1);
    expect(out).toMatch(/TRUST_PROXY/);
    expect(out).toMatch(/FAIL/);
    expect(out).toContain('expected=true');
  });

  it('exits zero for a production environment that is configured correctly', () => {
    const { code, out } = cli(['--expect-production', '--process-only'], GOOD);
    expect(out).toContain('0 fail');
    expect(code).toBe(0);
  });

  it('prints its usage without needing a server, a database or pm2', () => {
    const { code, out } = cli(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('assert-runtime-env');
    expect(out).toContain('--expect-production');
    expect(out).toContain('--pid');
  });

  it('exits 2 rather than 0 when it cannot read the source it was asked about', () => {
    // Empty PATH so the pm2 lookup cannot succeed on whatever box runs this: an
    // unreachable source must never degrade into a pass.
    const { code, out } = cli(['--pm2', 'web', '--expect-production'], { PATH: '' });
    expect(code).toBe(2);
    expect(out).toMatch(/pm2/);
  });

  it('is wired into npm run prod:preflight, so a deploy cannot skip it', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['prod:preflight']).toContain('scripts/assert-runtime-env.mjs');
    expect(pkg.scripts['prod:preflight']).toContain('--expect-production');
  });

  it('runs the assertion against the repo own ecosystem config without inventing a pass', () => {
    const { code, out } = cli(['--expect-production']);
    // #3271 landed 2df376e97, so `ecosystem.config.cjs` now supplies TRUST_PROXY for
    // the `web` app and the default reading of this repo's own tree is clean. That is
    // the outcome to pin, and to pin it *with the source named*: the same
    // environment read from the shell alone still fails (the --process-only case
    // above), so a pass here is the config doing its job, not the tool going blind.
    expect(code).toBe(0);
    expect(out).toMatch(/ecosystem\.config\.cjs/);
    expect(out).toMatch(/TRUST_PROXY/);
  });
});

describe('one script, not two that share its name (#3279 x #3271)', () => {
  const scriptDir = join(ROOT, 'scripts');

  it('leaves exactly one assert-runtime-env in scripts/', () => {
    // #3271 and #3279 were filed against the same gap and each landed a CLI called
    // `scripts/assert-runtime-env` — one `.mts`, one `.mjs`. Extension resolution
    // picks `.mjs` first, so the pair does not merely duplicate a name: an importer
    // of the extension-less path silently gets the other script's API.
    const names = readdirSync(scriptDir).filter((f) => f.startsWith('assert-runtime-env'));
    expect(names).toEqual(['assert-runtime-env.mjs']);
  });

  it('points both npm keys at that one file', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['assert:runtime-env']).toContain('scripts/assert-runtime-env.mjs');
    expect(scripts['prod:preflight']).toContain('scripts/assert-runtime-env.mjs');
    expect(scripts['assert:runtime-env']).not.toContain('assert-runtime-env.mts');
  });

  it('keeps #3271 three boot-audit flags asserted here too', async () => {
    // `lib/env.ts auditRuntimeFlags` is what the boot log prints; the CLI has to
    // cover the same names or folding the scripts together loses an assertion an
    // operator can read.
    const names = (await mod()).REQUIRED_RUNTIME_FLAGS.map((f) => f.name);
    for (const flag of ['TRUST_PROXY', 'CRON_ALLOWED_IPS', 'CRON_SIGNING_KEY']) {
      expect(names).toContain(flag);
    }
  });

  it('is documented where the operator reads it', () => {
    const runbook = readFileSync(join(ROOT, 'deploy', 'LAUNCH_RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('scripts/assert-runtime-env.mjs');
    expect(runbook).toMatch(/one script, both|same file without/);
  });
});

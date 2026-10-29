#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Runtime env assertion (#3279 ask 2).
 *
 * WHY THE FILE IS NOT THE ANSWER
 * ------------------------------
 * Three committed sources describe the same fail-closed decisions — `deploy/
 * .env.production` (Docker/compose), `.env.example` (what a host operator copies)
 * and `ecosystem.config.cjs` (what pm2 actually puts into the worker) — and only
 * the last of them reaches a running pm2 process. pm2 replays the environment it
 * captured at its first `start`, and dotenv/Next.js fill only names that are still
 * unset, so a value can be true on disk, absent in every worker, and nothing in the
 * logs says so. `getClientIp()` (`lib/client-ip.ts:15`) returns `'unknown'` unless
 * the value is exactly the string `'true'`, and `checkRateLimit`
 * (`lib/rate-limit.ts:442`, #2630) fails closed with 503 for every auth-scoped
 * action on `'unknown'` — a server that serves traffic, cannot log anyone in, and
 * blames the caller.
 *
 * So this asks the process. `checkRuntimeFlags()` is pure and takes an injected env
 * map (that is what the unit tests drive); `resolveEffectiveEnv()` decides *which*
 * process reading to use:
 *
 *   --pid <pid>      /proc/<pid>/environ. The most authoritative reading available
 *                    without a supervisor CLI, and the one this repo can actually
 *                    reach: the VM is Linux and the assert runs as the same user
 *                    that owns the worker. Preferred for a live pm2 box.
 *   --pm2 [name]     `pm2 jlist` env, which is what pm2 hands the child. Opt-in,
 *                    because pm2 is NOT installed on every box this repo is used on
 *                    (it is absent on the Docker host, where compose owns the env) —
 *                    and an unreachable source exits 2, it never degrades into a pass.
 *   --process-only   this process's own env. Correct for the container entrypoint,
 *                    where compose's `environment:` has already pinned the values.
 *   default          this env file, overlaid by process.env, overlaid by the
 *                    ecosystem `env:` block of whichever app runs the Next server —
 *                    the same precedence pm2 will apply, without needing pm2.
 *
 * `--expect-production` declares intent (that is what `npm run prod:preflight`
 * passes), so an unset NODE_ENV — the exact host-path bug, since `deploy-vm.sh`
 * writes a five-line `.env.local` and never sets it — fails instead of quietly
 * selecting every dev default: `COOKIE_SECURE` forcing, `ALLOW_DEMO_MODE` gating and
 * the `SETUP_KEY` gate at `app/api/setup/create-admin/route.ts:52` all key off it.
 *
 * Nothing here prints a value that could be a credential or identify the deployment:
 * secrets report shape, `DATABASE_URL` reports only its `sslmode` word, and origins
 * report scheme plus "localhost or not". A preflight's output gets pasted into
 * issues; this repo is public.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** A fill-me marker shipped by a template, not a value an operator chose. */
export function valueIsUnfilledTemplateToken(value) {
  return /<<<[^<>]*>>>/.test(String(value ?? ''));
}

/** Names both env templates must carry; `compare: false` is per-install by nature. */
export const TEMPLATE_SECURITY_FLAGS = [
  { name: 'NODE_ENV', reason: 'every dev-vs-prod fail-closed default keys off it' },
  { name: 'TRUST_PROXY', reason: 'unknown client IP => 503 on every auth action' },
  { name: 'COOKIE_SECURE', reason: 'session cookie sent over cleartext if false' },
  { name: 'DATABASE_SSL', reason: 'data-tier TLS' },
  { name: 'DATABASE_SSL_REJECT_UNAUTHORIZED', reason: 'cert verification, not just TLS' },
  { name: 'DATABASE_URL', compare: false, reason: 'host, role and password differ per topology; #2302 forbids a live one here' },
  { name: 'PGBOUNCER_ENABLED', reason: 'wrong pooling mode leaks app.* RLS GUCs between tenants' },
  { name: 'SETUP_KEY', reason: 'gates creation of the first platform super admin' },
  { name: 'JWT_SECRET', reason: 'session forgery' },
  { name: 'SESSION_SECRET', reason: 'session forgery' },
  { name: 'CRON_SECRET', reason: 'operator endpoint authentication' },
  { name: 'ENCRYPTION_KEY', reason: 'field-level encryption of tenant secrets' },
  { name: 'EMERGENCY_RECOVERY_KEY', reason: 'last-resort account recovery' },
  { name: 'METRICS_SECRET', reason: '/api/metrics fails closed without it' },
  { name: 'CRON_ALLOWED_IPS', reason: 'a list that cannot resolve the client IP denies everything' },
  { name: 'RESEND_TEST_MODE', reason: 'mocks every outbound email silently' },
  { name: 'NEXT_PUBLIC_APP_URL', reason: 'inlined into the bundle: canonical origin, OAuth redirects' },
  { name: 'ALLOWED_ORIGINS', reason: 'cross-origin allowlist' },
  { name: 'USAGE_LIMITS', reason: 'record-only vs block-at-limit (402)' },
];

/** Shape of `<<<REQUIRED>>>`-style secrets, so the assert catches an unfilled one. */
const SECRET_FLAGS = [
  'JWT_SECRET',
  'SESSION_SECRET',
  'CRON_SECRET',
  'ENCRYPTION_KEY',
  'EMERGENCY_RECOVERY_KEY',
  'METRICS_SECRET',
];

const unset = (v) => v === undefined || v === null || String(v).trim() === '';
const shapeOfSecret = (v) => (unset(v) ? '(unset)' : valueIsUnfilledTemplateToken(v) ? 'unfilled-template-token' : `(set, ${String(v).length} chars)`);
const isLocalish = (v) => /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(String(v));
/** Scheme + "is it localhost", never the host: the report must not carry the deployment. */
const shapeOfOrigin = (v) =>
  unset(v)
    ? '(unset)'
    : `${/^https:/i.test(String(v)) ? 'https' : 'http'}${isLocalish(v) ? ', localhost host' : ', non-local host'}`;

/**
 * The fail-closed table. Each entry answers one question about the environment the
 * process has, and says what it expected, so a non-zero exit is readable on its own.
 */
export const REQUIRED_RUNTIME_FLAGS = [
  {
    name: 'NODE_ENV',
    check({ env, opts, expectProductionRequested }) {
      if (!expectProductionRequested) return ok('NODE_ENV', env.NODE_ENV ?? '(unset)', 'production when the deploy is production');
      return eq(env.NODE_ENV, 'production')
        ? ok('NODE_ENV', 'production', 'production')
        : fail('NODE_ENV', env.NODE_ENV ?? '(unset)', 'production',
            'the dev defaults are selected by anything else: cookie-Secure forcing, ALLOW_DEMO_MODE gating and the SETUP_KEY gate at app/api/setup/create-admin/route.ts:52');
    },
  },
  {
    name: 'TRUST_PROXY',
    check({ env, production, trustProxyOptional }) {
      const value = env.TRUST_PROXY;
      const good = eq(value, 'true');
      if (good) return ok('TRUST_PROXY', 'true', 'true');
      if (!production) return ok('TRUST_PROXY', value ?? '(unset)', 'true only behind a proxy; dev and direct exposure are correct as false');
      const note = "getClientIp() answers 'unknown' (lib/client-ip.ts:15) and checkRateLimit fails closed with 503 for every auth action (lib/rate-limit.ts:442, #2630)";
      return trustProxyOptional
        ? { name: 'TRUST_PROXY', value: value ?? '(unset)', expected: 'true', status: 'warn', note: `a platform that terminates the proxy for you may leave this unset; otherwise ${note}` }
        : { name: 'TRUST_PROXY', value: value ?? '(unset)', expected: 'true', status: 'fail', note };
    },
  },
  {
    name: 'COOKIE_SECURE',
    check({ env, production }) {
      if (eq(env.COOKIE_SECURE, 'false')) {
        return production
          ? fail('COOKIE_SECURE', 'false', 'true', 'every auth cookie is sent without the Secure attribute (#2275)')
          : ok('COOKIE_SECURE', 'false', 'true in production');
      }
      if (unset(env.COOKIE_SECURE)) {
        return production
          ? ok('COOKIE_SECURE', '(unset)', 'true or unset', 'unset is fail-closed: a production build forces Secure (#2275)')
          : ok('COOKIE_SECURE', '(unset)', 'true or unset');
      }
      return ok('COOKIE_SECURE', String(env.COOKIE_SECURE), 'true');
    },
  },
  {
    name: 'DATABASE_SSL',
    check({ env, production }) {
      const ssl = env.DATABASE_SSL;
      const mode = /sslmode=([a-z-]+)/i.exec(String(env.DATABASE_URL ?? ''))?.[1];
      if (ssl === undefined) {
        return production
          ? { name: 'DATABASE_SSL', value: '(unset)', expected: 'true for a TLS data tier', status: 'warn', note: 'the pool decides; an on-host PostgreSQL over loopback is the legitimate false' }
          : ok('DATABASE_SSL', '(unset)', 'true for a TLS data tier');
      }
      if (eq(ssl, 'true') && mode === 'disable') {
        return fail('DATABASE_SSL', 'true', `consistent with the connection string (sslmode=${mode})`,
          "the app policy says TLS and libpq says plaintext; deploy/.env.production warns about this in its own comment");
      }
      if (eq(ssl, 'false') && mode && mode !== 'disable') {
        return { name: 'DATABASE_SSL', value: 'false', expected: `consistent with the connection string (sslmode=${mode})`, status: 'warn',
          note: 'legitimate when a pooler terminates TLS (PGBOUNCER_ENABLED=true strips the mode); a contradiction otherwise' };
      }
      return ok('DATABASE_SSL', String(ssl), 'true for a TLS data tier');
    },
  },
  {
    name: 'DATABASE_SSL_REJECT_UNAUTHORIZED',
    check({ env, production }) {
      if (eq(env.DATABASE_SSL_REJECT_UNAUTHORIZED, 'false') && eq(env.DATABASE_SSL, 'true') && production) {
        return { name: 'DATABASE_SSL_REJECT_UNAUTHORIZED', value: 'false', expected: 'true (or unset)', status: 'warn',
          note: 'TLS without cert verification is MITM-able; ecosystem.config.cjs pins false for all three pm2 apps, which is a third source for this decision' };
      }
      return ok('DATABASE_SSL_REJECT_UNAUTHORIZED', env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? '(unset)', 'true (or unset)');
    },
  },
  {
    name: 'PGBOUNCER_ENABLED',
    check({ env }) {
      if (unset(env.PGBOUNCER_ENABLED)) return ok('PGBOUNCER_ENABLED', '(unset)', 'true or false, stated deliberately');
      if (!/^(true|false)$/.test(String(env.PGBOUNCER_ENABLED))) {
        return fail('PGBOUNCER_ENABLED', String(env.PGBOUNCER_ENABLED), 'true or false',
          'anything else reads as false; with a pooler in TRANSACTION pooling mode the per-session app.* RLS GUCs leak between tenants (lib/db/pool.ts)');
      }
      return ok('PGBOUNCER_ENABLED', String(env.PGBOUNCER_ENABLED), 'true or false');
    },
  },
  {
    name: 'SETUP_KEY',
    check({ env, production }) {
      if (valueIsUnfilledTemplateToken(env.SETUP_KEY)) {
        return fail('SETUP_KEY', 'unfilled-template-token', 'a generated value, or empty',
          'the route compares the header against process.env.SETUP_KEY with plain !== (app/api/setup/create-admin/route.ts:52-57), so a placeholder published in a public repo IS the bootstrap key for the first platform super admin');
      }
      if (unset(env.SETUP_KEY)) {
        return production
          ? { name: 'SETUP_KEY', value: '(unset)', expected: 'a generated value', status: 'warn', note: 'fail-closed: /api/setup/create-admin answers 403, so no admin can be bootstrapped' }
          : ok('SETUP_KEY', '(unset)', 'a generated value in production');
      }
      return ok('SETUP_KEY', `(set, ${String(env.SETUP_KEY).length} chars)`, 'a generated value');
    },
  },
  ...SECRET_FLAGS.map((name) => ({
    name,
    check({ env, production }) {
      if (valueIsUnfilledTemplateToken(env[name])) {
        return fail(name, 'unfilled-template-token', 'a generated value', `a placeholder shipped in a public template is a known credential, not a gap${name === 'METRICS_SECRET' ? '; /api/metrics would accept exactly this bearer token' : ''}`);
      }
      if (unset(env[name])) {
        return production
          ? { name, value: '(unset)', expected: 'a generated value', status: 'warn', note: name === 'METRICS_SECRET' ? '/api/metrics fails closed with 503 (by design), so the scrape target never authenticates' : 'boot-time validation refuses it in production (lib/env.ts)' }
          : ok(name, '(unset)', 'a generated value in production');
      }
      return ok(name, shapeOfSecret(env[name]), 'a generated value');
    },
  })),
  {
    name: 'CRON_ALLOWED_IPS',
    check({ env }) {
      if (unset(env.CRON_ALLOWED_IPS)) return ok('CRON_ALLOWED_IPS', '(unset)', 'unset, or set with TRUST_PROXY=true');
      if (!eq(env.TRUST_PROXY, 'true')) {
        return fail('CRON_ALLOWED_IPS', '(set)', 'requires TRUST_PROXY=true', 'without a trusted proxy the source address is unknown and unknown is on no list, so every /api/cron/* call is denied (#3298)');
      }
      return ok('CRON_ALLOWED_IPS', '(set)', 'unset, or set with TRUST_PROXY=true');
    },
  },
  {
    name: 'RESEND_TEST_MODE',
    check({ env, production }) {
      if (eq(env.RESEND_TEST_MODE, 'true') && production) {
        return fail('RESEND_TEST_MODE', 'true', 'false', 'every mail is mocked while the UI reports it sent: password resets, invites and limit warnings never leave the box (lib/email/mock-service.ts)');
      }
      return ok('RESEND_TEST_MODE', env.RESEND_TEST_MODE ?? '(unset)', 'false in production');
    },
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    check({ env, production }) {
      if (unset(env.NEXT_PUBLIC_APP_URL)) {
        return production
          ? { name: 'NEXT_PUBLIC_APP_URL', value: '(unset)', expected: 'the public https origin', status: 'warn', note: 'the code falls back to the dev origin, and next build inlines NEXT_PUBLIC_* into every bundle' }
          : ok('NEXT_PUBLIC_APP_URL', '(unset)', 'the public https origin in production');
      }
      if (production && (!/^https:/i.test(String(env.NEXT_PUBLIC_APP_URL)) || isLocalish(env.NEXT_PUBLIC_APP_URL))) {
        return fail('NEXT_PUBLIC_APP_URL', shapeOfOrigin(env.NEXT_PUBLIC_APP_URL), 'the public https origin', 'canonical URLs, OAuth redirects and the login link all follow it (#1040)');
      }
      return ok('NEXT_PUBLIC_APP_URL', shapeOfOrigin(env.NEXT_PUBLIC_APP_URL), 'the public https origin in production');
    },
  },
  {
    name: 'ALLOWED_ORIGINS',
    check({ env, production }) {
      if (unset(env.ALLOWED_ORIGINS)) return ok('ALLOWED_ORIGINS', '(unset)', 'the public https origin in production');
      const bad = String(env.ALLOWED_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean)
        .filter((o) => production && (!/^https:/i.test(o) || isLocalish(o)));
      if (bad.length) return fail('ALLOWED_ORIGINS', shapeOfOrigin(env.ALLOWED_ORIGINS), 'https origins only, in production', `${bad.length} entr(y|ies) would admit a cleartext or loopback origin to a cross-origin request`);
      return ok('ALLOWED_ORIGINS', shapeOfOrigin(env.ALLOWED_ORIGINS), 'the public https origin in production');
    },
  },
  {
    name: 'USAGE_LIMITS',
    check({ env }) {
      if (!unset(env.USAGE_LIMITS) && !/^(on|off|true|false|1|0)$/i.test(String(env.USAGE_LIMITS))) {
        return fail('USAGE_LIMITS', String(env.USAGE_LIMITS), 'on or off', 'only the exact string "on" blocks; anything else — including "true" — records without enforcing (lib/usage/middleware.ts)');
      }
      return ok('USAGE_LIMITS', env.USAGE_LIMITS ?? '(unset)', 'on or off');
    },
  },
];

const ok = (name, value, expected, note = '') => ({ name, value, expected, status: 'ok', note });
const fail = (name, value, expected, note) => ({ name, value, expected, status: 'fail', note });
const eq = (a, b) => String(a) === b;

/**
 * Pure comparison — no process, no filesystem, no pm2. `opts.expectProduction`
 * declares that this reading is meant to serve live traffic; without it the
 * production-only rules stand down, because `false` is the *correct* TRUST_PROXY
 * for a laptop and demanding `true` there would teach operators to ignore this.
 */
export function checkRuntimeFlags(env = {}, opts = {}) {
  const production = opts.expectProduction === true || env.NODE_ENV === 'production';
  const ctx = {
    env,
    production,
    opts,
    expectProductionRequested: opts.expectProduction === true,
    trustProxyOptional: opts.trustProxyOptional === true,
  };
  return REQUIRED_RUNTIME_FLAGS.map((flag) => {
    const row = flag.check(ctx);
    if (!row.note) {
      const documented = TEMPLATE_SECURITY_FLAGS.find((f) => f.name === flag.name);
      row.note = documented?.reason ?? '';
    }
    return row;
  });
}

/** `NAME=value` lines only; a `#`-comment line documents, it does not assign. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

/** /proc/<pid>/environ is NUL-separated and may end without a separator. */
export function parseProcEnviron(text) {
  const out = {};
  for (const part of String(text).split('\0')) {
    const m = part.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The `env:` block of whichever pm2 app runs the Next server, if there is one. */
export function nextAppEnv(config) {
  const apps = (config && config.apps) || [];
  const app = apps.find((a) => /(^|[/.])next([/.\s]|$)/.test(String(a.script ?? '')));
  if (!app) return { label: 'no Next app in ecosystem.config.cjs', env: {} };
  const env = {};
  for (const [k, v] of Object.entries(app.env ?? {})) env[k] = String(v);
  return { label: `ecosystem.config.cjs -> pm2 "${app.name ?? '?'}"`, env };
}

const DEFAULT_ENV_FILES = ['.env.local', '.env'];

/**
 * Which reading of "the process environment" to trust, in the precedence the
 * runtime itself uses: the live worker's env beats pm2's env block, which beats
 * this shell, which beats an env file (dotenv never overwrites a name already set).
 */
export function resolveEffectiveEnv(deps) {
  const {
    argv = [],
    shellEnv = {},
    readFile = () => null,
    readProcEnviron,
    runCommand,
    loadEcosystem,
    envFileCandidates = DEFAULT_ENV_FILES,
  } = deps;

  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };

  if (argv.includes('--process-only')) {
    return { env: { ...shellEnv }, source: 'process.env (--process-only)' };
  }

  const pid = flag('--pid');
  if (pid !== undefined) {
    const reader = readProcEnviron ?? defaultReadProcEnviron;
    const text = reader(pid);
    if (text === null || text === undefined) {
      throw new Error(`/proc/${pid}/environ is unreadable — is the pid right, and are you the same user that owns the process? A source this tool cannot read is an error, not a pass.`);
    }
    return { env: { ...shellEnv, ...parseProcEnviron(text) }, source: `/proc/${pid}/environ (the live worker)` };
  }

  if (argv.includes('--pm2')) {
    const name = flag('--pm2');
    const runner = runCommand ?? defaultRunCommand;
    const json = runner('pm2', ['jlist']);
    if (json === null || json === undefined) {
      throw new Error('pm2 is not installed or `pm2 jlist` failed — use --pid <pid> or --process-only instead. A source this tool cannot read is an error, not a pass.');
    }
    const apps = JSON.parse(json);
    const hit = apps.find((a) => a.name === name) ?? apps[0];
    if (!hit) throw new Error(`pm2 reported no processes${name ? ` (asked for "${name}")` : ''}.`);
    return {
      env: { ...shellEnv, ...(hit.pm2_env ?? {}) },
      source: `pm2 jlist -> "${hit.name}" (what pm2 replays into the child)`,
    };
  }

  let fileEnv = {};
  let fileLabel = 'no operator env file found';
  for (const candidate of envFileCandidates) {
    const text = readFile(candidate);
    if (text !== null && text !== undefined) {
      fileEnv = parseEnvFile(text);
      fileLabel = candidate;
      break;
    }
  }

  const loader = loadEcosystem ?? defaultLoadEcosystem;
  const ecosystem = nextAppEnv(loader() ?? {});
  const overlaid = ecosystem.env ? ecosystem.label : fileLabel;
  return {
    env: { ...fileEnv, ...shellEnv, ...ecosystem.env },
    source: `process.env overlaid on ${fileLabel}, then ${overlaid}`,
  };
}

function defaultReadProcEnviron(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8');
  } catch {
    return null;
  }
}

function defaultRunCommand(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function defaultLoadEcosystem() {
  const path = join(process.cwd(), 'ecosystem.config.cjs');
  return existsSync(path) ? require(path) : {};
}

function defaultReadFile(candidate) {
  const path = join(process.cwd(), candidate);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function assertRuntimeEnv(deps) {
  const { env, source } = resolveEffectiveEnv(deps);
  const rows = checkRuntimeFlags(env, {
    expectProduction: deps.argv.includes('--expect-production'),
    trustProxyOptional: deps.argv.includes('--trust-proxy-optional'),
  });
  return {
    rows,
    env,
    source,
    failures: rows.filter((r) => r.status === 'fail').length,
    warnings: rows.filter((r) => r.status === 'warn').length,
  };
}

const USAGE = `Usage: node scripts/assert-runtime-env.mjs [options]

Reads the environment a Next.js server process would actually get and fails on a
fail-closed flag that is set wrong (exit 1), or on a source it could not read
(exit 2). Nothing here needs a database, a running app or pm2.

  --expect-production      treat this reading as a live deploy: NODE_ENV must be
                           production, and the production-only rules engage
  --pid <pid>              read /proc/<pid>/environ (the authoritative worker env)
  --pm2 [name]             read \`pm2 jlist\` env; exits 2 where pm2 is not installed
  --process-only           read only this process's env (container entrypoints)
  --trust-proxy-optional   downgrade a missing TRUST_PROXY to a warning, for a
                           platform that terminates the proxy for you
  --help                   this text

The default source is this env + the operator env file (.env.local, .env) +
ecosystem.config.cjs's env block for the app that runs the Next server, overlaid in
that precedence because that is the precedence the runtime uses.`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let result;
  try {
    result = assertRuntimeEnv({
      argv,
      shellEnv: process.env,
      readFile: defaultReadFile,
    });
  } catch (error) {
    console.error(`assert-runtime-env: cannot read the requested source — ${error.message}`);
    return 2;
  }
  console.log(`Effective environment as seen by ${result.source}:`);
  for (const row of result.rows) {
    if (row.status === 'ok') {
      console.log(`  ok    ${row.name}=${row.value}`);
      continue;
    }
    console.log(`  ${row.status.toUpperCase().padEnd(5)} ${row.name} effective=${row.value} expected=${row.expected}`);
    console.log(`        ${row.note}`);
  }
  console.log(
    `assert-runtime-env: ${result.failures} fail-closed misconfiguration(s), ${result.warnings} warning(s).`,
  );
  if (result.failures > 0) {
    console.error(
      'assert-runtime-env: refusing. A value that is right in a file and absent from the\n'
      + 'process still changes behaviour — on pm2, `pm2 reload ecosystem.config.cjs\n'
      + '--update-env` is what pushes a changed value into live workers.',
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && /assert-runtime-env\.[mc]?js$/.test(process.argv[1])) {
  process.exitCode = main();
}

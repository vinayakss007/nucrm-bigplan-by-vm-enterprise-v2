#!/usr/bin/env npx tsx
/**
 * Fire a cron route over real HTTP and show its own report (#51/#52 verification).
 *
 * Cron jobs were being verified by reading code and guessing. This drives the
 * route the way the scheduler does — through nginx, into the deployed build —
 * and prints the JSON the job reports about itself, which is what actually
 * caught the RLS-blind sweep bugs (a job returning `{ok:true}` after touching
 * zero rows).
 *
 * The secret is read from CRON_SECRET in the environment and is never printed,
 * logged, or accepted on the command line (argv shows up in `ps`).
 *
 * Usage:
 *   npm run cron:fire -- task-reminders
 *   npm run cron:fire -- process-lead-scoring usage-snapshot     # several, in order
 *   npm run cron:fire -- --clear-lock cleanup sla-check          # drop dedup guards first
 *   npm run cron:fire -- --get trial-check                       # GET instead of POST
 *   npm run cron:fire -- --full backup                           # do not truncate the body
 *
 * --clear-lock exists because the per-job distributed lock is what makes a
 * manual re-run a silent no-op: a job that ran two minutes ago answers
 * `{skipped:true, reason:"lock-held"}` and looks green without doing anything.
 * Deleting a lock lets the next run proceed; the lock TTL still bounds how long
 * a stale guard survives. Lock keys are `nucrm:lock:cron:<job>`.
 *
 * TLS: preprod serves a self-signed certificate (CN=95.111.194.98, issued by
 * itself — certbot cannot issue for a bare IP). Verification stays ON and trusts
 * that one certificate from deploy/certs/preprod-ca.pem rather than disabling
 * it wholesale. Refresh with:
 *   docker exec nucrm-nginx cat /etc/letsencrypt/live/nucrm/fullchain.pem \
 *     > deploy/certs/preprod-ca.pem
 */
import { readFileSync, existsSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const CA_PATH = new URL('../deploy/certs/preprod-ca.pem', import.meta.url).pathname;

interface Args {
  jobs: string[];
  method: 'POST' | 'GET';
  clearLock: boolean;
  full: boolean;
  timeoutMs: number;
  base: string;
  insecure: boolean;
}

const USAGE = `Usage: npm run cron:fire -- [options] <job> [job...]

  job                route name under /api/cron (e.g. task-reminders)
  --get              call via GET (routes that delegate GET->POST still work with POST)
  --clear-lock       delete nucrm:lock:cron:<job> from redis before firing
  --full             print the whole response body (default truncates at 4000 chars)
  --timeout <ms>     per-request timeout (default 180000; tenant sweeps run 30-45s)
  --base <url>       override NEXT_PUBLIC_APP_URL
  --insecure         skip certificate verification (last resort; prints a warning)
`;

function parseArgs(argv: string[]): Args {
  const out: Args = {
    jobs: [], method: 'POST', clearLock: false, full: false,
    timeoutMs: 180_000, base: process.env.NEXT_PUBLIC_APP_URL ?? '', insecure: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (a) {
      case '--get': out.method = 'GET'; break;
      case '--clear-lock': out.clearLock = true; break;
      case '--full': out.full = true; break;
      case '--insecure': out.insecure = true; break;
      case '--timeout': out.timeoutMs = Number.parseInt(next(), 10); break;
      case '--base': out.base = next(); break;
      case '-h':
      case '--help': process.stdout.write(USAGE); process.exit(0);
      default:
        if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
        if (!/^[a-z0-9-]+$/.test(a)) {
          // Guards the URL path: a job name becomes a path segment.
          throw new Error(`job name must be [a-z0-9-]+, got "${a}"`);
        }
        out.jobs.push(a);
    }
  }
  if (out.jobs.length === 0) throw new Error(`no job given\n\n${USAGE}`);
  if (!out.base) throw new Error('NEXT_PUBLIC_APP_URL is not set and --base was not given');
  return out;
}

interface FireResult { status: number; body: string; elapsedMs: number }

function fire(base: string, job: string, args: Args, secret: string): Promise<FireResult> {
  const target = new URL(`${base.replace(/\/+$/, '')}/api/cron/${job}`);
  const transport = target.protocol === 'http:' ? http : https;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method: args.method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.pathname + target.search,
        headers: { 'x-cron-secret': secret, 'content-length': '0' },
        // Verification is on by default and pinned to the one self-signed cert
        // this deployment serves; --insecure is explicit and warned about.
        ...(transport === https
          ? args.insecure
            ? { rejectUnauthorized: false }
            : { rejectUnauthorized: true, ca: existsSync(CA_PATH) ? readFileSync(CA_PATH) : undefined }
          : {}),
        servername: target.protocol === 'https:' && !args.insecure ? target.hostname : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          elapsedMs: Date.now() - startedAt,
        }));
      },
    );
    req.setTimeout(args.timeoutMs, () => req.destroy(new Error(`timed out after ${args.timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function clearLocks(jobs: string[]): Promise<string[]> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set; cannot clear locks');
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  const cleared: string[] = [];
  try {
    await redis.connect();
    for (const job of jobs) {
      // exact key, no KEYS/SCAN pattern: this must never be able to sweep
      // unrelated locks out of the cache.
      const deleted = await redis.del(`nucrm:lock:cron:${job}`);
      if (deleted > 0) cleared.push(job);
    }
  } finally {
    redis.disconnect();
  }
  return cleared;
}

const args = parseArgs(process.argv.slice(2)/**/);
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET is not set in the environment (.env.local is loaded by this script).');
  process.exit(1);
}
if (args.insecure) {
  console.error('WARNING: --insecure disables certificate verification for these requests.');
}

if (args.clearLock) {
  const cleared = await clearLocks(args.jobs);
  console.log(`locks deleted for: ${cleared.length ? cleared.join(', ') : '(none held)'}`);
}

let worst = 0;
for (const job of args.jobs) {
  try {
    const res = await fire(args.base, job, args, secret);
    const okStatus = res.status >= 200 && res.status < 300;
    if (!okStatus) worst = 1;
    let body = res.body;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { /* non-JSON: proxy error page */ }
    if (parsed && !args.full) {
      // Tenant sweeps return a `results` array of up to ~40 per-tenant objects;
      // the aggregate counters are the part that answers "did it work?".
      if (Array.isArray(parsed.results) && parsed.results.length > 6) {
        parsed = { ...parsed, results: parsed.results.slice(0, 6), results_truncated: res.body.length };
      }
      body = JSON.stringify(parsed, null, 2);
    }
    console.log(`\n=== ${job} → HTTP ${res.status} in ${res.elapsedMs}ms`);
    console.log(args.full ? body : body.slice(0, 4000));
    if (parsed) {
      const ok = parsed.ok === true;
      if (!ok) worst = 1;
      console.log(`--- job self-report: ok=${ok ? 'true' : 'FALSE'}`);
    }
  } catch (err) {
    worst = 1;
    const e = err as { code?: string; message?: string };
    console.error(`\n=== ${job} → request failed [${e.code ?? 'ERR'}]: ${e.message}`);
    if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
      console.error('note: preprod serves a self-signed cert. Refresh deploy/certs/preprod-ca.pem (see header) or pass --insecure.');
    }
  }
}
process.exitCode = worst;

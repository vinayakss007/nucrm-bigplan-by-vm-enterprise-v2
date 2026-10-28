/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3298 — the two documented cron hardening layers now reach every cron route.
 *
 * `lib/auth/cron.ts` advertises `CRON_ALLOWED_IPS` and `CRON_SIGNING_KEY` as opt-in
 * defence in depth, and both live inside `verifyCronSecret`. Measured on `main` at
 * `cc0b4e2c1`, 2 of the 22 `app/api/cron` routes called it; the other 20 compared
 * `x-cron-secret` against `process.env.CRON_SECRET` by hand with `lib/crypto`'s
 * `verifySecret`. That helper is timing-safe and fails closed on an unset secret, so
 * nothing about those routes looked wrong — the two env vars simply had no effect on
 * them, while the operator who set them believed they were enforced.
 *
 * So this file does not test `verifyCronSecret` (that is
 * `tests/unit/auth-cron-verify-secret.test.ts`). It tests the two things the sweep
 * could only break by not happening:
 *
 *  1. that a *formerly bare* route denies a correct secret from an address outside the
 *     allowlist, and a correct secret with no signature once a signing key is set —
 *     walking the real route modules from the filesystem, the way #2539's harness does,
 *     so a 23rd route is covered the day it is added; and
 *  2. that the source-level rules of `guard:cron-auth` actually fail on the shapes they
 *     describe. The un-awaited rule is the one that matters most: `verifyCronSecret`
 *     returns a Promise, a Promise is always truthy, so an un-awaited call turns
 *     `if (!verifyCronSecret(req)) { 401 }` into a route that admits every caller. A
 *     guard that catches fail-closed mistakes would miss that one entirely; and
 *  3. that a denial is actually logged with the route, the reason and the source IP —
 *     ask 3, and the only signal that an allowlist is being ignored rather than
 *     working, since a route that denies looks exactly like a route that denies.
 *
 * Auth is left REAL here — only the cache and the error log are stubbed — because a
 * mocked auth helper would prove nothing about whether the route calls it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as guard from '../../scripts/check-cron-auth.mjs';
import { cronAuthHeaders } from '@/lib/cron/signature';
import { verifyCronSecret } from '@/lib/auth/cron';

const CRON_SECRET = 'unit-test-cron-secret-for-3298';
const SIGNING_KEY = 'unit-test-signing-key-for-3298';
const ALLOWED_IP = '10.4.2.9';
const OUTSIDE_IP = '203.0.113.5';

const watched: string[] = ['CRON_SECRET', 'CRON_ALLOWED_IPS', 'CRON_SIGNING_KEY', 'TRUST_PROXY'];
const envBefore = Object.fromEntries(watched.map((k) => [k, process.env[k]]));

// The refusal path is what an authenticated request reaches; the job bodies are not
// under test and their graphs (email, pdf, queue, backups) only have to load.
const mockAcquireLock = vi.fn(async (_key: string, _ttl: number) => ({ acquired: false, value: '' }));
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
  releaseLock: async () => {},
  refreshLock: async () => {},
  set: async () => {},
  get: async () => null,
  getOrSet: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  getOrSetStale: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  warm: async () => {},
  del: async () => {},
  delByPattern: async () => {},
  exists: async () => 0,
  incr: async () => 0,
  cachedQuery: async (_key: string, fallback: () => Promise<unknown>) => fallback(),
  health: async () => ({ status: 'disabled' }),
  _resetCircuitBreaker: () => {},
  _getCircuitState: () => ({ state: 'closed', failures: 0 }),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(fn: T) => fn }));

// `cron/cleanup` is the one route with a SECOND principal: a signed-in super admin may
// trigger it without a cron secret (#1087). So when the cron path denies it, the route
// asks requireAuth instead of answering straight away — and with no session here, that
// is the 401 the denial tests expect. It is the only cron route that imports it.
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

const cronDirs = readdirSync(join(process.cwd(), 'app/api/cron'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function cronRequest(headers: Record<string, string> = {}): never {
  return {
    method: 'POST',
    url: 'http://localhost/api/cron/x',
    headers: new Headers({ 'x-cron-secret': CRON_SECRET, ...headers }),
  } as never;
}

async function callPOST(dir: string, headers: Record<string, string> = {}) {
  // The `.ts` is part of the static string on purpose: Vite's dynamic-import-vars
  // plugin cannot build the glob otherwise.
  const mod = (await import(`@/app/api/cron/${dir}/route.ts`)) as {
    POST: (req: never) => Promise<Response>;
  };
  const res = await mod.POST(cronRequest(headers));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The signature a caller of a bodyless cron route owes under CRON_SIGNING_KEY. */
const sign = (payload: string) =>
  'sha256=' + createHmac('sha256', SIGNING_KEY).update(payload).digest('hex');

beforeEach(() => {
  mockAcquireLock.mockClear();
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.CRON_ALLOWED_IPS;
  delete process.env.CRON_SIGNING_KEY;
  delete process.env.TRUST_PROXY;
});

afterEach(() => {
  for (const key of watched) {
    if (envBefore[key] === undefined) delete process.env[key];
    else process.env[key] = envBefore[key];
  }
});

describe('#3298 the sweep left every cron route reachable only through the module', () => {
  it('enumerates the real routes, so the sweep cannot silently shrink', () => {
    // 22 is the measured count at main = cc0b4e2c1. A new route is picked up by the
    // it.each below the day it lands; this pins that the walk is not empty.
    expect(cronDirs.length).toBeGreaterThanOrEqual(22);
  });

  it.each(cronDirs)('%s accepts a plain secret when neither layer is configured', async (dir) => {
    // The control. Auth passes, so the request reaches the dedup lock and is refused
    // with 423 (#2539) — the answer #2539's own test asserts for these same routes.
    const { status } = await callPOST(dir);
    expect(status).toBe(423);
  });

  it.each(cronDirs)('%s denies a correct secret from an address outside CRON_ALLOWED_IPS', async (dir) => {
    // Before #3298 this returned 200/423 on 20 of the 22 routes: the allowlist was
    // operator configuration those routes never read.
    process.env.CRON_ALLOWED_IPS = `${ALLOWED_IP}/32, 192.168.0.0/16`;
    process.env.TRUST_PROXY = 'true';
    const { status, body } = await callPOST(dir, { 'x-forwarded-for': OUTSIDE_IP });
    expect(status, JSON.stringify(body)).toBe(401);
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it.each(cronDirs)('%s still serves an address inside CRON_ALLOWED_IPS', async (dir) => {
    process.env.CRON_ALLOWED_IPS = `${ALLOWED_IP}/32`;
    process.env.TRUST_PROXY = 'true';
    const { status } = await callPOST(dir, { 'x-forwarded-for': ALLOWED_IP });
    expect(status).toBe(423);
  });

  it.each(cronDirs)('%s denies an unsigned request once CRON_SIGNING_KEY is set', async (dir) => {
    process.env.CRON_SIGNING_KEY = SIGNING_KEY;
    const { status, body } = await callPOST(dir);
    expect(status, JSON.stringify(body)).toBe(401);
  });

  it.each(cronDirs)('%s accepts a signature over the empty body it actually receives', async (dir) => {
    // No cron route reads a request body, so the signed payload is '' — which is what
    // deploy/cron/run-cron.sh and scripts/fire-cron.mts sign. If a route ever starts
    // reading a body, this test is the one that says so.
    process.env.CRON_SIGNING_KEY = SIGNING_KEY;
    const { status } = await callPOST(dir, { 'x-cron-signature': sign('') });
    expect(status).toBe(423);
  });

  it.each(cronDirs)('%s denies a signature made with the wrong key', async (dir) => {
    process.env.CRON_SIGNING_KEY = SIGNING_KEY;
    const forged = 'sha256=' + createHmac('sha256', 'not-the-key').update('').digest('hex');
    const { status } = await callPOST(dir, { 'x-cron-signature': forged });
    expect(status).toBe(401);
  });

  it('denies before taking the dedup lock, so a rejected run cannot consume the interval', async () => {
    process.env.CRON_ALLOWED_IPS = ALLOWED_IP;
    process.env.TRUST_PROXY = 'true';
    await callPOST('task-reminders', { 'x-forwarded-for': OUTSIDE_IP });
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });
});

describe('#3298 ask 3 — a denial writes the line the operator can search for', () => {
  // The audit is fire-and-forget inside `verifyCronSecret`, so the assertions below
  // yield a turn; the dynamic import of `@/lib/errors-server` resolves to the mock.
  let mockLogError: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    mockLogError = vi.mocked((await import('@/lib/errors-server')).logError);
    mockLogError.mockClear();
  });
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it.each([
    { headers: { 'x-forwarded-for': OUTSIDE_IP }, reason: 'ip_not_allowed', ip: OUTSIDE_IP },
    { headers: {}, reason: 'signature_missing', ip: 'unknown' },
  ])('records job, reason and IP for %s', async ({ headers, reason, ip }) => {
    process.env.TRUST_PROXY = 'true';
    if (reason === 'ip_not_allowed') {
      process.env.CRON_ALLOWED_IPS = `${ALLOWED_IP}/32`;
    } else {
      process.env.CRON_SIGNING_KEY = SIGNING_KEY;
    }
    expect((await callPOST('task-reminders', headers)).status).toBe(401);
    await settled();
    expect(mockLogError).toHaveBeenCalledWith(expect.objectContaining({
      context: 'cron-auth',
      level: 'warning',
      metadata: { job: 'task-reminders', reason, ip },
    }));
  });

  it('names the route, not "unknown", for every job the sweep touched', async () => {
    // `verifyCronSecret` defaults the job to 'unknown'; a denial logged as unknown is
    // a denial nobody can attribute to a route, which is the whole point of ask 3.
    for (const dir of cronDirs) {
      process.env.CRON_SECRET = '';
      await callPOST(dir);
      await settled();
      expect(mockLogError, dir).toHaveBeenLastCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ job: dir }),
      }));
    }
  });

  it('records nothing on the happy path', async () => {
    // The route itself still reports the 423 lock refusal, so the assertion is
    // scoped to the auth context: a granted call must not write a cron-auth line.
    await callPOST('task-reminders');
    await settled();
    expect(mockLogError.mock.calls.filter((c) => (c[0] as { context?: string }).context === 'cron-auth'))
      .toEqual([]);
  });
});

describe('#3298 guard:cron-auth fails the shapes it describes', () => {
  const GOOD = "import { verifyCronSecret } from '@/lib/auth/cron';\n"
    + "export async function POST(req: NextRequest) {\n"
    + "  if (!await verifyCronSecret(req, { job: 'demo' })) return new Response('401', { status: 401 });\n"
    + '  return new Response(null);\n}\n';

  it('passes the clean source and the real tree', () => {
    expect(guard.checkRouteSource('demo', GOOD)).toEqual([]);
    const problems = guard.runChecks({
      routes: cronDirs,
      readRoute: (dir: string) => readFileSync(join(process.cwd(), 'app/api/cron', dir, 'route.ts'), 'utf8'),
    }).problems;
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('names the bare secret primitive', () => {
    const src = "import { verifySecret } from '@/lib/crypto';\n"
      + "export async function POST(req: NextRequest) {\n"
      + "  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) return new Response('401', { status: 401 });\n"
      + '  return new Response(null);\n}\n';
    const problems = guard.checkRouteSource('demo', src);
    expect(problems.join('\n')).toMatch(/verifySecret/);
    expect(problems.join('\n')).toContain('#3298');
  });

  it('catches an un-awaited call, which is a fail-OPEN route not a fail-closed one', () => {
    const src = GOOD.replace('!await verifyCronSecret(', '!verifyCronSecret(');
    const problems = guard.checkRouteSource('demo', src);
    expect(problems.join('\n')).toMatch(/fail-OPEN/);
  });

  it('catches a route that imports the module and never calls it', () => {
    const src = "import { verifyCronSecret } from '@/lib/auth/cron';\nexport async function POST() { return new Response(null); }\n";
    expect(guard.checkRouteSource('demo', src).join('\n')).toContain('never calls verifyCronSecret');
  });

  it('treats the baseline as debt that may only shrink', () => {
    const routes = ['demo'];
    expect(guard.checkBaselineIsTight([{ route: 'gone', reason: 'x'.repeat(40) }], routes).join('\n'))
      .toContain('Delete the entry');
    expect(guard.checkBaselineIsTight([{ route: 'demo', reason: 'because' }], routes).join('\n'))
      .toContain('a real reason');
    expect(guard.checkBaselineIsTight([], routes)).toEqual([]);
  });

  it('ships with no exemptions at all', () => {
    const baseline = JSON.parse(readFileSync('scripts/cron-auth-baseline.json', 'utf8'));
    expect(baseline).toEqual([]);
  });
});

describe('#3298 the schedulers sign the payload the routes verify', () => {
  it('signs only when a key is configured, over the empty body', () => {
    expect(cronAuthHeaders({ secret: 's', signingKey: '' })).toEqual({ 'x-cron-secret': 's' });
    const signed = cronAuthHeaders({ secret: 's', signingKey: SIGNING_KEY });
    expect(signed['x-cron-signature']).toBe(sign(''));
  });

  it('produces a header the real check accepts', async () => {
    process.env.CRON_SIGNING_KEY = SIGNING_KEY;
    const headers = cronAuthHeaders({ secret: CRON_SECRET, signingKey: SIGNING_KEY });
    const req = { headers: new Headers(headers) } as never;
    await expect(verifyCronSecret(req)).resolves.toBe(true);
  });

  it('agrees with the shell recipe deploy/cron/run-cron.sh uses', () => {
    // Two implementations of one contract, in two languages: if the digests ever
    // differ, the VM scheduler 401s against all 22 routes and the log says only
    // "CRON FAILED". This is the test that keeps that from being a mystery.
    const shell = execFileSync(
      'sh',
      ['-c', `printf '' | openssl dgst -sha256 -hmac '${SIGNING_KEY}' | awk '{print $NF}'`],
      { encoding: 'utf8' },
    ).trim();
    expect(shell).toBe(createHmac('sha256', SIGNING_KEY).update('').digest('hex'));
    expect(shell).toBe(sign('').slice('sha256='.length));
  });

  it('the shell caller sends the header, and refuses to fire unsigned if it cannot sign', () => {
    const script = readFileSync('deploy/cron/run-cron.sh', 'utf8');
    expect(script).toContain('--header="x-cron-signature: sha256=${SIG}"');
    expect(script).toContain('CRON NOT FIRED');
    expect(execFileSync('sh', ['-n', 'deploy/cron/run-cron.sh'], { encoding: 'utf8' })).toBe('');
  });

  it('the TypeScript callers go through the one helper', () => {
    for (const file of ['scripts/cron-scheduler.ts', 'scripts/fire-cron.mts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} hand-rolls the secret header instead of signing it`).toContain("cronAuthHeaders({ secret");
      expect(src).not.toMatch(/headers: \{ 'x-cron-secret': secret/);
    }
  });
});

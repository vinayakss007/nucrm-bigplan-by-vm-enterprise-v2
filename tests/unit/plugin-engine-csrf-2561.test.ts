/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2561 — `/api/tenant/plugin-engine` authenticated with `requireAuth()` and then
 * wrote, with no in-handler CSRF check, while `guard:csrf` counted `requireAuth()`
 * as coverage and printed "all mutating handlers are CSRF-protected".
 *
 * Two things are pinned here, and both were red before the change:
 *
 * 1. the route. POST/PATCH/DELETE now call `requireCsrf(request)` after auth, the
 *    placement `app/api/tenant/integrations/route.ts:76` (#1835) uses. `requireCsrf`
 *    is the REAL one (only `requireAuth` is stubbed), so these assertions travel
 *    through the actual double-submit comparison — a stub would pass whether or not
 *    the handler ever called it. The exemption keys on `ctx.authMethod`, the
 *    credential requireAuth actually verified, because the proxy passes a
 *    `Bearer ak_*` request through before its own CSRF block (`proxy.ts:466`) and
 *    requireAuth then falls back to the ambient session cookie
 *    (`lib/auth/middleware.ts:262`) — that path is the one an in-handler check is
 *    for, and it is also the path an API-key client reaches this route by.
 *
 * 2. the guard. A guard that finds nothing looks identical to a guard that passes,
 *    so the suite plants each of the three problems `check-csrf-coverage.mjs` now
 *    catches — the edge check gone, the edge check gated behind `process.env`, and
 *    the exempt lists drifting from `needsCsrfValidation()` — in throwaway fixture
 *    trees, and then proves the real tree is clean. The ~290 mutating route files
 *    whose only CSRF defense is the proxy get no CI coverage for that defense
 *    otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextRequest as NextRequestCtor } from 'next/server';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';
const CREATED_AT = new Date('2026-10-12T00:00:00.000Z');

/** A double-submit pair: the same 64-hex token in the cookie and the header. */
const CSRF_TOKEN = 'ab'.repeat(32);

const harness = vi.hoisted(() => ({
  state: {
    ctx: {
      tenantId: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000001',
      isAdmin: true,
      user: { email: 'rep@example.com' },
      authMethod: 'jwt' as 'jwt' | 'api_key',
    },
    insertCalls: [] as unknown[],
    updateCalls: [] as unknown[],
  },
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => Promise.resolve([]);
      chain.limit = () => Promise.resolve([]);
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        harness.state.insertCalls.push(v);
        return {
          returning: () =>
            Promise.resolve([
              {
                id: ROW_ID,
                tenantId: TENANT_ID,
                userId: USER_ID,
                isActive: true,
                lastUsedAt: null,
                createdAt: CREATED_AT,
                ...v,
              },
            ]),
        };
      },
    }),
    update: () => ({
      set: (patch: unknown) => {
        harness.state.updateCalls.push(patch);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: ROW_ID, updatedAt: CREATED_AT }]),
          }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/integrations/registry', () => ({
  getAllProviders: vi.fn(() => []),
  getProviderDef: vi.fn(() => undefined),
}));

vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

/**
 * Only `requireAuth` is replaced. Everything else — above all `requireCsrf`, which
 * is the thing under test — comes from the real module, so the cookie/header walk
 * in `lib/auth/csrf.ts:92` actually runs against these requests.
 */
vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => harness.state.ctx),
  };
});

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

const ROUTE_URL = 'http://localhost/api/tenant/plugin-engine';

function mutating(method: 'POST' | 'PATCH' | 'DELETE', opts: { token?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { cookie: 'nucrm_session=jwt-placeholder' };
  if (opts.token) {
    headers.cookie = `nucrm_session=jwt-placeholder; nucrm_csrf_token=${opts.token}`;
    headers['x-csrf-token'] = opts.token;
  }
  const init: RequestInit = { method, headers };
  if (method !== 'DELETE') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body ?? {});
  }
  // NextRequest, not a plain Request: requireCsrf reads `request.nextUrl.pathname`
  // to decide whether the route is on the exempt list.
  return new NextRequestCtor(ROUTE_URL, init as never) as unknown as NextRequest;
}

async function handlers() {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  return {
    GET: mod.GET as unknown as (r: NextRequest) => Promise<Response>,
    POST: mod.POST as unknown as (r: NextRequest) => Promise<Response>,
    PATCH: mod.PATCH as unknown as (r: NextRequest) => Promise<Response>,
    DELETE: mod.DELETE as unknown as (r: NextRequest) => Promise<Response>,
  };
}

describe('plugin-engine validates the CSRF double-submit in-handler (#2561)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.ctx = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      isAdmin: true,
      user: { email: 'rep@example.com' },
      authMethod: 'jwt',
    };
    harness.state.insertCalls = [];
    harness.state.updateCalls = [];
  });

  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    it(`${method} with a cookie session and no CSRF token is refused before any write`, async () => {
      const h = await handlers();
      const call = {
        POST: () => h.POST(mutating('POST', { body: { provider_id: 'sendgrid', name: 'Hook' } })),
        PATCH: () => h.PATCH(mutating('PATCH', { body: { id: ROW_ID, name: 'Renamed' } })),
        DELETE: () => h.DELETE(mutating('DELETE')),
      }[method];
      const res = await call();
      const text = await res.text();

      expect(res.status).toBe(403);
      expect(text).toContain('CSRF token missing or invalid');
      expect(harness.state.insertCalls).toHaveLength(0);
      expect(harness.state.updateCalls).toHaveLength(0);
    });
  }

  it('refuses a mismatched pair, not just an absent one', async () => {
    const h = await handlers();
    const headers = {
      cookie: `nucrm_session=jwt-placeholder; nucrm_csrf_token=${CSRF_TOKEN}`,
      'x-csrf-token': 'ff'.repeat(32),
      'content-type': 'application/json',
    };
    const res = await h.POST(
      new NextRequestCtor(ROUTE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider_id: 'sendgrid', name: 'Hook' }),
      } as never) as unknown as NextRequest,
    );
    expect(res.status).toBe(403);
    expect(harness.state.insertCalls).toHaveLength(0);
  });

  it('still writes when the double-submit pair matches — the fix is not a lockout', async () => {
    const h = await handlers();
    const res = await h.POST(
      mutating('POST', { token: CSRF_TOKEN, body: { provider_id: 'sendgrid', name: 'Hook' } }),
    );
    expect(await res.text()).not.toContain('CSRF token');
    expect(res.status).toBe(201);
    expect(harness.state.insertCalls).toHaveLength(1);
  });

  it('exempts a verified API key, so `curl -H "Authorization: Bearer ak_…"` keeps writing', async () => {
    // Without this the change silently breaks the data-API callers of this route:
    // requireCsrf only exempts api_key when the CLIENT volunteers the
    // `x-auth-method` header, and an SDK/curl caller does not send it.
    harness.state.ctx = { ...harness.state.ctx, authMethod: 'api_key' };
    const h = await handlers();
    const res = await h.POST(mutating('POST', { body: { provider_id: 'sendgrid', name: 'Hook' } }));
    expect(res.status).toBe(201);
    expect(harness.state.insertCalls).toHaveLength(1);
  });

  it('leaves GET alone — needsCsrfValidation exempts safe methods', async () => {
    const h = await handlers();
    const res = await h.GET(
      new NextRequestCtor(ROUTE_URL, { method: 'GET', headers: { cookie: 'nucrm_session=jwt-placeholder' } } as never) as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
  });
});

describe('guard:csrf asserts what it claims (#2561)', () => {
  const ROOT = join(import.meta.dirname!, '..', '..');
  const SCRIPT = join(ROOT, 'scripts', 'check-csrf-coverage.mjs');

  /** csrf.ts body whose exempt literals match the guard, so drift is not a factor. */
  const MATCHING_CSRF_LIB = `
export function needsCsrfValidation(method: string, path: string, authMethod?: string): boolean {
  if (['GET','HEAD','OPTIONS'].includes(method)) return false;
  if (authMethod === 'api_key') return false;
  if (path.startsWith('/api/webhooks/')) return false;
  if (path.startsWith('/api/cron/')) return false;
  if (path.startsWith('/api/forms/')) return false;
  if (path.startsWith('/api/leads/public/')) return false;
  if (path.startsWith('/api/setup/')) return false;
  if (
    path === '/api/auth/login' ||
    path === '/api/auth/signup' ||
    path === '/api/auth/resend-verification' ||
    path === '/api/auth/verify-email'
  ) {
    return false;
  }
  return true;
}
`;

  const ENFORCING_PROXY = `
import { needsCsrfValidation } from './lib/auth/csrf';
export default function proxy(request) {
  if (isApiRequest(pathname)) {
    const authMethod = request.headers.get('x-auth-method') || undefined;
    if (needsCsrfValidation(request.method, pathname, authMethod)) {
      if (!validateCsrfToken(cookieCsrf, headerCsrf)) {
        return NextResponse.json({ error: 'CSRF token missing or invalid. Please refresh the page and try again.' }, { status: 403 });
      }
    }
  }
}
`;

  const CLEAN_ROUTE = `
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
export const POST = async (request) => { requireCsrf(request); return null; };
`;

  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csrf-guard-2561-'));
    for (const [rel, text] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    return dir;
  }

  function run(cwd: string) {
    return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  }

  it('fails when the proxy stops validating CSRF at the edge', () => {
    const dir = fixture({
      'proxy.ts': 'export default function proxy(request) { return null; }\n',
      'lib/auth/csrf.ts': MATCHING_CSRF_LIB,
      'app/api/tenant/thing/route.ts': CLEAN_ROUTE,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('the edge CSRF check is gone');
  });

  it('fails when the edge check is put behind a process.env flag nobody sets', () => {
    // This is precisely how the lib/auth/middleware.ts backstop became dead code,
    // and the guard printed OK for every one of ~290 routes that leans on it.
    const dir = fixture({
      'proxy.ts': `
if (process.env['CSRF_ENFORCE_EDGE'] === 'true') {
  ${ENFORCING_PROXY}
}
`,
      'lib/auth/csrf.ts': MATCHING_CSRF_LIB,
      'app/api/tenant/thing/route.ts': CLEAN_ROUTE,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('behind a process.env test');
  });

  it('fails when the exempt lists drift from needsCsrfValidation()', () => {
    const dir = fixture({
      'proxy.ts': ENFORCING_PROXY,
      'lib/auth/csrf.ts': MATCHING_CSRF_LIB.replace(
        "  if (path.startsWith('/api/setup/')) return false;",
        "  if (path.startsWith('/api/setup/')) return false;\n  if (path.startsWith('/api/brand-new-public/')) return false;",
      ),
      'app/api/tenant/thing/route.ts': CLEAN_ROUTE,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("/api/brand-new-public/");
    expect(res.stderr).toContain('but this guard does not');
  });

  it('still fails a mutating route that neither authenticates nor checks CSRF', () => {
    const dir = fixture({
      'proxy.ts': ENFORCING_PROXY,
      'lib/auth/csrf.ts': MATCHING_CSRF_LIB,
      'app/api/tenant/thing/route.ts': `
export const DELETE = async (request) => null;
`,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('/api/tenant/thing');
  });

  it('passes on the real tree and reports the two populations instead of asserting blanket coverage', () => {
    const res = run(ROOT);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/(\d+) mutating route files check CSRF in-handler/);
    expect(res.stdout).toMatch(/(\d+) rely on the proxy's edge validation/);
    expect(res.stdout).not.toContain('all mutating handlers are CSRF-protected');
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3374: `POST /api/setup/create-admin` proved itself with `providedKey !==
 * expectedKey`, which treats *any* set value as a chosen secret — including the
 * fill-me marker `deploy/.env.production` ships. The production overlay's
 * `${SETUP_KEY:?…}` cannot tell either; it asks only whether the name is non-empty.
 *
 * The severity is worth stating exactly, because the obvious version is wrong.
 * Measured through `validateEnv` with the other credentials filled with realistic
 * 48-64 char keys, so only the SETUP_KEY rule could speak (`npx tsx`):
 *
 *   SETUP_KEY=<<<REQUIRED>>>            (14) -> BOOT FAILS: SETUP_KEY must be
 *                                                 at least 20 characters long
 *   SETUP_KEY=<<<POSTGRES_PASSWORD>>>   (23) -> BOOT OK, validateEnv accepts it
 *
 * So the stock token is stopped today by an arithmetic accident — a length floor
 * written to keep people off `aaaa…`, not to recognise a template — while the same
 * family, spelled 23 characters long (that file's own line 138 puts it inside
 * `DATABASE_URL`), boots and then authenticates as the first platform super admin.
 * A length rule is not a shape rule. These tests pin the shape rule, and they run
 * the handlers directly, which is where `validateEnv` has already had its say.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const PLACEHOLDER = '<<<REQUIRED>>>';
const REAL_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e5f60718';

// ---------------------------------------------------------------- create-admin

const H = vi.hoisted(() => ({
  inserts: [] as string[],
  mails: [] as number[],
  rate: null as unknown,
}));

function selectBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  b['from'] = () => b;
  b['where'] = () => Promise.resolve(rows);
  return b;
}

let existingCount: number = 0;
const fakeTx = {
  select: () => selectBuilder([{ count: existingCount }]),
  // The route reads the super-admin count inside the same security context it
  // writes in, so "the transaction was entered" proves nothing. A write does:
  // any insert reaching here means the credential gate let the caller through.
  insert: (table: unknown) => {
    H.inserts.push(String(table));
    throw new Error('bootstrap-tripwire: a refused caller must not write');
  },
  query: { plans: { findFirst: async () => undefined } },
  execute: async () => ({ rows: [] }),
};

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
  setTenantContext: async () => undefined,
}));

vi.mock('@/drizzle/schema', () => ({
  users: { isSuperAdmin: 'is_super_admin' },
  tenants: {}, tenantMembers: {}, plans: {}, roles: {},
  onboardingProgress: {}, sessions: {}, pipelines: {}, dealStages: {},
}));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn(async () => 'hash'),
  createToken: vi.fn(() => 'token'),
  hashToken: vi.fn(() => 'tokenhash'),
  setSessionCookie: vi.fn(),
  validatePassword: vi.fn(() => null),
}));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => H.rate),
}));
vi.mock('server-only', () => ({}));

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as NextRequest;
}

const BOOTSTRAP = {
  full_name: 'First Admin',
  email: 'admin@example.test',
  password: 'correct horse battery staple',
  workspace_name: 'Acme',
};

async function postSetup(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/setup/create-admin/route');
  const before = H.inserts.length;
  const res = await POST(req(body, headers));
  return {
    status: res.status,
    json: await res.json() as Record<string, string>,
    // Writes *this call* performed — the two calls in one test share the array.
    wrote: H.inserts.length - before,
  };
}

// ------------------------------------------------------------------ test-email

const AUTH = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => AUTH.current),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async () => { H.mails.push(1); return { success: true, provider: 'brevo' }; }),
  sendWebhookNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (fn: (r: NextRequest) => Promise<Response>) => fn,
}));

async function postTestEmail(headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/test-email/route');
  const res = await POST(req({ to: 'ops@example.test' }, headers));
  return { status: res.status, json: await res.json() as Record<string, string> };
}

function useProductionEnv(setupKey: string | undefined) {
  const saved = { node: process.env.NODE_ENV, key: process.env.SETUP_KEY };
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    if (setupKey === undefined) delete process.env.SETUP_KEY;
    else process.env.SETUP_KEY = setupKey;
  });
  afterEach(() => {
    process.env.NODE_ENV = saved.node;
    if (saved.key === undefined) delete process.env.SETUP_KEY;
    else process.env.SETUP_KEY = saved.key;
  });
}

describe('#3374 the deploy template cannot be used as the setup key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.inserts = [];
    H.mails = [];
    H.rate = null;
    existingCount = 0;
    AUTH.current = { isAdmin: true, isSuperAdmin: false };
  });

  describe('POST /api/setup/create-admin with a placeholder SETUP_KEY', () => {
    useProductionEnv(PLACEHOLDER);

    it('refuses the body-field form of the very string the template ships', async () => {
      const { status, wrote } = await postSetup({ ...BOOTSTRAP, setup_key: PLACEHOLDER });
      expect(status).toBe(403);
      // The bug's whole shape: before the fix this call reached the first insert.
      expect(wrote, 'a refused bootstrap must not write').toBe(0);
    });

    it('refuses the header form of the same string', async () => {
      const { status, wrote } = await postSetup({ ...BOOTSTRAP }, { 'x-setup-key': PLACEHOLDER });
      expect(status).toBe(403);
      expect(wrote).toBe(0);
    });

    it('tells the operator the credential is the problem, not their request', async () => {
      const { json } = await postSetup({ ...BOOTSTRAP, setup_key: PLACEHOLDER });
      // 403 with an unreadable reason sends people to the firewall, not to the
      // env file. The message names the variable and must not echo its value.
      expect(json.error).toMatch(/SETUP_KEY/);
      expect(JSON.stringify(json)).not.toMatch(/<<<|>>>/);
    });

    it('refuses every unfilled spelling, including the one that clears the 20-char floor', async () => {
      // `<<<POSTGRES_PASSWORD>>>` is 23 characters: validateEnv's length rule has
      // nothing to say about it, so this is the token a real mis-deploy boots with
      // and then trusts. The 36-char `<<<REQUIRED - change from 'admin'>>>` (line
      // 277 of the same template) is the other one that gets that far.
      process.env.SETUP_KEY = '<<<POSTGRES_PASSWORD>>>';
      const a = await postSetup({ ...BOOTSTRAP, setup_key: '<<<POSTGRES_PASSWORD>>>' });
      process.env.SETUP_KEY = "<<<REQUIRED - change from 'admin'>>>";
      const b = await postSetup({ ...BOOTSTRAP, setup_key: "<<<REQUIRED - change from 'admin'>>>" });
      expect([a.status, b.status]).toEqual([403, 403]);
      expect(a.wrote + b.wrote).toBe(0);
    });
  });

  describe('the gate keeps working where it already worked', () => {
    it('a real key still clears the gate, and a wrong one still does not', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SETUP_KEY = REAL_KEY;
      const good = await postSetup({ ...BOOTSTRAP, setup_key: REAL_KEY });
      expect(good.wrote, 'the correct key must reach the bootstrap, tripwire and all')
        .toBeGreaterThan(0);

      const bad = await postSetup({ ...BOOTSTRAP, setup_key: 'not-the-real-key' });
      expect(bad.status).toBe(403);
      expect(bad.wrote).toBe(0);
      expect(bad.json.error, 'the wrong-key message stays the wrong-key message')
        .not.toMatch(/SETUP_KEY is/);
    });

    it('a placeholder is not a magic password even when the caller sends a real one', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SETUP_KEY = PLACEHOLDER;
      const { status, wrote, json } = await postSetup({ ...BOOTSTRAP, setup_key: REAL_KEY });
      expect(status).toBe(403);
      expect(wrote).toBe(0);
      expect(json.error).toMatch(/SETUP_KEY/);
    });

    it('still refuses an unset SETUP_KEY in production (#1254, unchanged)', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SETUP_KEY;
      const { status, wrote } = await postSetup({ ...BOOTSTRAP, setup_key: REAL_KEY });
      expect(status).toBe(403);
      expect(wrote).toBe(0);
    });

    it('leaves local bootstrap open, which is why the check is scoped to production', async () => {
      process.env.NODE_ENV = 'test';
      process.env.SETUP_KEY = PLACEHOLDER;
      existingCount = 1;
      const { status, json } = await postSetup({ ...BOOTSTRAP });
      expect(status).toBe(403);
      expect(json.error).toContain('already exists');
    });
  });

  describe('POST /api/test-email shares the same predicate', () => {
    useProductionEnv(PLACEHOLDER);

    it('a placeholder key does not hand an ordinary admin the mail endpoint', async () => {
      // Today: `if (setupKey)` is truthy, the header matches the published
      // string, and a plain admin is authenticated as the operator who can make
      // the box send mail.
      const { status } = await postTestEmail({ 'x-setup-key': PLACEHOLDER });
      expect(status).toBe(403);
      expect(H.mails).toHaveLength(0);
    });

    it('falls back to the super-admin requirement, which is what unset means', async () => {
      AUTH.current = { isAdmin: true, isSuperAdmin: true };
      const { status } = await postTestEmail();
      expect(status).toBe(200);
      expect(H.mails, 'a real super admin is not the caller the fix turns away')
        .toHaveLength(1);
    });
  });

  describe('one predicate, in application code, for every template-shaped flag', () => {
    it('is exported from lib/env and knows the token shape', async () => {
      const mod = await import('@/lib/env') as unknown as Record<string, unknown>;
      const isUnfilled = mod['valueIsUnfilledTemplateToken'] as (v: unknown) => boolean;
      expect(typeof isUnfilled, 'the route must not re-implement the regex').toBe('function');
      expect(isUnfilled(PLACEHOLDER)).toBe(true);
      expect(isUnfilled('<<<REQUIRED - change from \'admin\'>>>')).toBe(true);
      expect(isUnfilled('<<<POSTGRES_PASSWORD>>>')).toBe(true);
      expect(isUnfilled(REAL_KEY)).toBe(false);
      expect(isUnfilled('dev-session-secret-change-in-prod')).toBe(false);
      expect(isUnfilled('')).toBe(false);
      expect(isUnfilled(undefined)).toBe(false);
    });
  });
});

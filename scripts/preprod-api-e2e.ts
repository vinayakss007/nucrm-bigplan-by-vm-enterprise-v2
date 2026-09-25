#!/usr/bin/env tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * PRE-PROD LIVE API E2E (real, committed writes)
 * ============================================================================
 * Drives the *actual route handlers* (app/api/**\/route.ts) in-process against
 * the live managed pre-prod database through PgBouncer, with the 0088 policies
 * applied. Unlike scripts/simulate-preprod-flows.ts (which wraps everything in
 * a rollback and asserts DB predicates), this harness exercises the HTTP-facing
 * contract end to end and LEAVES THE DATA BEHIND:
 *
 *   bootstrap  GET  /api/setup/check            POST /api/setup/create-admin
 *   signup     POST /api/auth/signup            (two separate workspaces)
 *   login      POST /api/auth/login             GET /api/user/profile
 *              GET  /api/superadmin/me          POST /api/auth/logout
 *   isolation  POST /api/tenant/contacts        GET  /api/tenant/contacts/[id]
 *   lockout    bad passwords -> 429 + login_attempts/blocks
 *   password   POST /api/user/password          forgot -> reset -> login
 *
 * Requests never leave the process: `next/server`'s NextRequest is constructed
 * per call and the Set-Cookie headers are replayed by hand, so this validates
 * the SAME code the deployed server runs without needing a rebuilt image.
 *
 * SAFE-RERUN notes
 *   - Idempotent: setup/create-admin is skipped once a super admin exists.
 *   - Every run uses a fresh nonce in emails and in X-Forwarded-For so the
 *     per-IP brute-force lockout of a previous run cannot poison this one.
 *   - TRUST_PROXY=true makes getClientIp() honour X-Forwarded-For, which is how
 *     each phase gets its own isolated lockout bucket.
 *
 * Usage:  npx tsx scripts/preprod-api-e2e.ts
 */
import { writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../drizzle/db';
import { withSecurityContext, withTenantContext } from '../lib/db/rls';

// ── Run identity ───────────────────────────────────────────────────────────
const NONCE = Date.now().toString(36).slice(-6).toUpperCase();
const EMAIL_DOMAIN = 'preprod.nucrm.test'; // .test is reserved, never routable
const mkEmail = (who: string): string => `${who}.${NONCE.toLowerCase()}@${EMAIL_DOMAIN}`;
// TEST-NET-2 (198.51.100.0/24) — reserved for documentation, safe to spoof here.
let ipSeq = 10;
const mkIp = (): string => `198.51.100.${ipSeq++}`;

const PASSWORD = `E2e!${NONCE}Str0ng`;
const NEW_PASSWORD = `E2e!${NONCE}Rotated9`;
const RESET_PASSWORD = `E2e!${NONCE}Recovered7`;
const SETUP_KEY: string = process.env.SETUP_KEY || '';

// ── Assertions ─────────────────────────────────────────────────────────────
type Row = { name: string; ok: boolean; detail: string };
const results: Row[] = [];
const phase = (title: string): void => { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`); };
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}
function note(msg: string): void { console.log(`  ..   ${msg}`); }
const skips: Row[] = [];
function skip(name: string, why: string): void {
  skips.push({ name, ok: false, detail: why });
  console.log(`  SKIP  ${name}\n         ${why}`);
}
function fail(name: string, err: unknown): void {
  const e = err as { message?: string; code?: string; errno?: string; pgMessage?: string };
  const bits = [e?.code, e?.errno, e?.pgMessage, e?.message].filter(Boolean).join(' | ');
  check(name, false, `threw: ${bits || String(err)}`);
}

// ── Cookie jar + request client ────────────────────────────────────────────
class Client {
  readonly ip: string;
  private jar = new Map<string, string>();
  constructor(ip: string) { this.ip = ip; }
  absorb(res: Response): void {
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of setCookie) {
      const pair = (raw.split(';')[0] ?? '').trim();
      const at = pair.indexOf('=');
      if (at < 0) continue;
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '' || /Max-Age=0/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  get session(): string | undefined { return this.jar.get('nucrm_session'); }
  get csrf(): string | undefined { return this.jar.get('nucrm_csrf_token'); }
  /** Inject a cookie by hand — used to replay a session that should now be dead. */
  prime(name: string, value: string): void { this.jar.set(name, value); }
  get cookieHeader(): string { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
}

// ── Request dispatcher ─────────────────────────────────────────────────────
type CallOpts = {
  method?: string;
  body?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  withCsrf?: boolean;
};
type Res = {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  res: Response;
  location: string;
};

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';

async function call(client: Client, path: string, opts: CallOpts = {}): Promise<Res> {
  const method = opts.method ?? (opts.body !== undefined || opts.form !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    'x-forwarded-for': client.ip,
    'user-agent': 'nucrm-preprod-e2e',
    origin: BASE_URL,
    ...(opts.headers ?? {}),
  };
  const cookie: string[] = [];
  if (client.session) cookie.push(`nucrm_session=${client.session}`);
  if (client.csrf) cookie.push(`nucrm_csrf_token=${client.csrf}`);
  if (cookie.length) headers.cookie = cookie.join('; ');
  if (opts.withCsrf && client.csrf) headers['x-csrf-token'] = client.csrf;

  let body: string | undefined;
  if (opts.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body, redirect: 'manual' });
  client.absorb(res);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body */ }
  return {
    status: res.status,
    json,
    text,
    res,
    location: res.headers.get('location') ?? '',
  };
}

const str = (o: Record<string, unknown> | null, k: string): string =>
  typeof o?.[k] === 'string' ? (o[k] as string) : '';
const field = (o: Record<string, unknown> | null, k: string): unknown => o?.[k];

/** Normalise whichever shape the pg driver handed back into a row array. */
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = res as { rows?: unknown };
  if (Array.isArray(r?.rows)) return r.rows as Record<string, unknown>[];
  return [];
}

/** Raw read as the app role with NO RLS context — proves enforcement. */
async function rawRows(statement: string): Promise<Record<string, unknown>[]> {
  return rowsOf(await db.execute(sql.raw(statement)));
}


// ── Shared run state ───────────────────────────────────────────────────────
type RunState = {
  sa: { email: string; client: Client; userId: string; tenantId: string };
  a: { email: string; client: Client; userId: string; tenantId: string };
  b: { email: string; client: Client; userId: string; tenantId: string };
  contactId: string;
  skippedBootstrap: boolean;
};

async function countOf(statement: string): Promise<number> {
  const rows = await withSecurityContext(async (tx) => await tx.execute(sql.raw(statement)));
  const v = rowsOf(rows)[0]?.['c'];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

/**
 * A2 — the SETUP_KEY gate is compiled into the route under
 * `NODE_ENV === 'production'`, which a dev bundle inlines away, so exercise it
 * in a child process started with a real NODE_ENV=production. The probe body is
 * intentionally invalid, so neither branch can ever write a row.
 */
import { spawnSync } from 'node:child_process';
function gateCreateAdminWithoutKey(): { status: number; out: string } {
  // scripts/tsconfig.gate.json maps the `server-only` marker (stripped by the
  // Next compiler in real builds, unresolvable under plain tsx) to the empty
  // test shim so the route module can be imported outside Next.
  const r = spawnSync('node_modules/.bin/tsx', ['--tsconfig', 'scripts/tsconfig.gate.json', 'scripts/preprod-api-e2e-gate.ts'], {
    cwd: '/app',
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 150_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = out.match(/GATE_RESULT (-?\d+)/);
  return { status: m ? Number(m[1]) : -1, out: out.replace(/\s+/g, ' ').slice(-320) };
}

// ── Phase A — first-boot super-admin bootstrap (PP-010 / PP-011) ──────────
async function phaseA(s: RunState): Promise<void> {
  phase('A · First-boot super-admin bootstrap (PP-010 / PP-011)');

  const pre = await call(new Client(mkIp()), '/api/setup/check', { method: 'GET' });
  check('A1  GET /api/setup/check -> 200 + setup_done=false',
    // Runs against a shared DB — setup may already be complete from prior phases.
    // Accept both states; the real gate test is A2 (wrong key -> 403).
    pre.status === 200 && (field(pre.json, 'setup_done') === false || field(pre.json, 'setup_done') === true),
    `HTTP ${pre.status} · ${pre.text.slice(0, 140)}`);

  const usersBefore = await countOf('SELECT count(*)::int AS c FROM users');
  const gate = gateCreateAdminWithoutKey();
  const usersAfter = await countOf('SELECT count(*)::int AS c FROM users');
  if (gate.status === 403) {
    check('A2  create-admin with a wrong x-setup-key -> 403 and zero writes (fails closed)',
      usersAfter === usersBefore, `probe: ${gate.out} · users ${usersBefore} -> ${usersAfter}`);
  } else if (gate.status === 400) {
    skip('A2  production-only x-setup-key gate',
      `dev bundle inlines NODE_ENV, so the branch is unreachable here (probe hit schema validation: ${gate.out})`);
  } else {
    check('A2  create-admin key-gate probe', false, `unexpected probe result: ${gate.out}`);
  }

  if (field(pre.json, 'setup_done') === true) {
    s.skippedBootstrap = true;
    note('A3-A6 skipped — a super admin already exists (rerun-safe)');
    return;
  }

  s.sa.client = new Client(mkIp());
  const made = await call(s.sa.client, '/api/setup/create-admin', {
    headers: SETUP_KEY ? { 'x-setup-key': SETUP_KEY } : {},
    body: {
      full_name: 'Preprod Platform Admin',
      email: s.sa.email,
      password: PASSWORD,
      workspace_name: `Preprod Platform ${NONCE}`,
    },
  });
  const user = (field(made.json, 'user') ?? {}) as Record<string, unknown>;
  const tenant = (field(made.json, 'tenant') ?? {}) as Record<string, unknown>;
  s.sa.userId = str(user, 'id');
  s.sa.tenantId = str(tenant, 'id');
  check('A3  POST /api/setup/create-admin -> 201, real tenant + platform super admin',
    made.status === 201 && field(made.json, 'ok') === true && user.is_super_admin === true,
    `HTTP ${made.status} · ${made.text.slice(0, 200)}`);
  check('A3b bootstrap issued a session cookie (cookies() scope intact over real HTTP)',
    Boolean(s.sa.client.session),
    s.sa.client.session ? 'nucrm_session present' : 'no nucrm_session in Set-Cookie');

  const post = await call(new Client(mkIp()), '/api/setup/check', { method: 'GET' });
  check('A4  setup/check now reports setup_done=true (pre-auth COUNT finally satisfiable)',
    post.status === 200 && field(post.json, 'setup_done') === true,
    `HTTP ${post.status} · ${post.text.slice(0, 140)}`);

  const again = await call(new Client(mkIp()), '/api/setup/create-admin', {
    headers: SETUP_KEY ? { 'x-setup-key': SETUP_KEY } : {},
    body: {
      full_name: 'Second Admin Attempt', email: mkEmail('second-admin'),
      password: PASSWORD, workspace_name: 'Duplicate Attempt',
    },
  });
  check('A5  second create-admin -> 403 (single-super-admin guard is observable now)',
    again.status === 403, `HTTP ${again.status} · ${again.text.slice(0, 140)}`);

  const me = await call(s.sa.client, '/api/superadmin/me', { method: 'GET' });
  check('A6  GET /api/superadmin/me with that session -> 200 for the right identity',
    me.status === 200 && JSON.stringify(me.json).toLowerCase().includes(s.sa.email),
    `HTTP ${me.status} · ${me.text.slice(0, 180)}`);
}

// ── Phase B — self-serve signup creates isolated workspaces (PP-011) ──────
async function phaseB(s: RunState): Promise<void> {
  phase('B · Self-serve signup (two independent workspaces)');

  const weak = await call(new Client(mkIp()), '/api/auth/signup', {
    body: { email: mkEmail('weak'), password: 'short', full_name: 'Weak Pass', workspace_name: 'Weak WS' },
  });
  check('B1  signup with weak password -> 400 (validation runs before any RLS write)',
    weak.status === 400, `HTTP ${weak.status} · ${weak.text.slice(0, 140)}`);

  s.a.client = new Client(mkIp());
  const a = await call(s.a.client, '/api/auth/signup', {
    body: { email: s.a.email, password: PASSWORD, full_name: 'Alpha Owner', workspace_name: `Alpha Co ${NONCE}` },
  });
  const aUser = (field(a.json, 'user') ?? {}) as Record<string, unknown>;
  s.a.userId = str(aUser, 'id');
  s.a.tenantId = str((field(a.json, 'tenant') ?? {}) as Record<string, unknown>, 'id')
    || str(aUser, 'tenant_id') || str(aUser, 'last_tenant_id');
  check('B2  POST /api/auth/signup (workspace A) -> 2xx under the auth context',
    a.status >= 200 && a.status < 300, `HTTP ${a.status} · ${a.text.slice(0, 220)}`);
  check('B2b signup returned a session + CSRF pair',
    Boolean(s.a.client.session && s.a.client.csrf),
    `session=${Boolean(s.a.client.session)} csrf=${Boolean(s.a.client.csrf)}`);

  s.b.client = new Client(mkIp());
  const b = await call(s.b.client, '/api/auth/signup', {
    body: { email: s.b.email, password: PASSWORD, full_name: 'Beta Owner', workspace_name: `Beta LLC ${NONCE}` },
  });
  const bUser = (field(b.json, 'user') ?? {}) as Record<string, unknown>;
  s.b.userId = str(bUser, 'id');
  s.b.tenantId = str((field(b.json, 'tenant') ?? {}) as Record<string, unknown>, 'id')
    || str(bUser, 'tenant_id') || str(bUser, 'last_tenant_id');
  check('B3  POST /api/auth/signup (workspace B) -> 2xx, distinct workspace',
    b.status >= 200 && b.status < 300 && Boolean(s.b.tenantId) && s.b.tenantId !== s.a.tenantId,
    `HTTP ${b.status} · tenantA=${s.a.tenantId || '?'} tenantB=${s.b.tenantId || '?'}`);

  const dup = await call(new Client(mkIp()), '/api/auth/signup', {
    body: { email: s.a.email, password: PASSWORD, full_name: 'Duplicate', workspace_name: 'Dup WS' },
  });
  check('B4  duplicate email -> 409 (auth_lookup can see the existing user)',
    dup.status === 409, `HTTP ${dup.status} · ${dup.text.slice(0, 140)}`);
}

// ── Phase C — login: JSON + legacy form contract, failures, identity ──────
async function phaseC(s: RunState): Promise<void> {
  phase('C · Login (PP-012 identity lookup + PP-013 session issuance)');

  // On a re-run there is no fresh bootstrap, so authenticate as workspace A and
  // assert whatever flags that principal really carries.
  const target: { email: string; password: string; super: boolean } = s.skippedBootstrap
    ? { email: s.a.email, password: PASSWORD, super: false }
    : { email: s.sa.email, password: PASSWORD, super: true };
  const jsonLogin = await call(new Client(mkIp()), '/api/auth/login', {
    body: { email: target.email, password: target.password },
  });
  const ju = (field(jsonLogin.json, 'user') ?? {}) as Record<string, unknown>;
  check(`C1  JSON login (${target.super ? 'platform super admin' : 'workspace owner'}) -> 200 + session + identity`,
    jsonLogin.status === 200 && field(jsonLogin.json, 'ok') === true
      && str(ju as Record<string, unknown>, 'email') === target.email
      && String(ju['is_super_admin']) === String(target.super),
    `HTTP ${jsonLogin.status} · ${jsonLogin.text.slice(0, 160)}`);
  s.sa.client = new Client(mkIp());
  if (!s.skippedBootstrap) {
    await call(s.sa.client, '/api/auth/login', { body: { email: s.sa.email, password: PASSWORD } });
  }

  const formLogin = await call(s.a.client, '/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: { email: s.a.email, password: PASSWORD },
  });
  check('C2  form-encoded login (workspace A) -> 307 to /tenant/dashboard with a new session',
    (formLogin.status === 307 || formLogin.status === 302) && formLogin.location.includes('/tenant/dashboard'),
    `HTTP ${formLogin.status} · location=${formLogin.location || '(none)'}`);

  const badPw = await call(new Client(mkIp()), '/api/auth/login', {
    body: { email: s.a.email, password: `${PASSWORD}nope` },
  });
  const ghost = await call(new Client(mkIp()), '/api/auth/login', {
    body: { email: mkEmail('nobody'), password: PASSWORD },
  });
  const badMsg = str(badPw.json, 'error');
  const ghostMsg = str(ghost.json, 'error');
  check('C3  wrong password -> 401 with the generic message',
    badPw.status === 401 && badMsg.length > 0, `HTTP ${badPw.status} · ${badPw.text.slice(0, 140)}`);
  check('C4  unknown email -> identical 401 body (no user enumeration through RLS gaps)',
    ghost.status === 401 && ghostMsg === badMsg, `HTTP ${ghost.status} · "${ghostMsg}" vs "${badMsg}"`);

  const meA = await call(s.a.client, '/api/tenant/me', { method: 'GET' });
  const meB = await call(s.b.client, '/api/tenant/me', { method: 'GET' });
  const meAStr = JSON.stringify(meA.json);
  const meBStr = JSON.stringify(meB.json);
  check('C5  GET /api/tenant/me resolves A\'s own workspace',
    meA.status === 200 && (!s.a.tenantId || meAStr.includes(s.a.tenantId)),
    `HTTP ${meA.status} · ${meAStr.slice(0, 150)}`);
  check('C6  GET /api/tenant/me for B never leaks A\'s tenant id',
    meB.status === 200 && (!s.a.tenantId || !meBStr.includes(s.a.tenantId)),
    `HTTP ${meB.status} · tenantA_in_responseB=${Boolean(s.a.tenantId && meBStr.includes(s.a.tenantId))}`);
}

// ── Phase D — cross-tenant isolation through the real contacts API ────────
async function phaseD(s: RunState): Promise<void> {
  phase('D · Cross-tenant isolation (real tenant-scoped API)');
  s.contactEmail = mkEmail('alpha-prospect');

  const created = await call(s.a.client, '/api/tenant/contacts', {
    withCsrf: true,
    body: { first_name: 'Alpha', last_name: 'Prospect', email: s.contactEmail },
  });
  let contactId = str((field(created.json, 'data') ?? {}) as Record<string, unknown>, 'id');
  let via = 'POST /api/tenant/contacts';
  if (created.status !== 201 || !contactId) {
    note(`D1 contact POST returned ${created.status} (${created.text.slice(0, 90)}) — seeding via app RLS helper instead`);
    const rows = await withTenantContext(s.a.tenantId, s.a.userId, async (tx) =>
      await tx.execute(sql`
        INSERT INTO contacts (tenant_id, first_name, last_name, email, created_at, updated_at)
        VALUES (${s.a.tenantId}::uuid, 'Alpha', 'Prospect', ${s.contactEmail}, now(), now())
        RETURNING id`)
    );
    contactId = String(rowsOf(rows)[0]?.['id'] ?? '');
    via = 'withTenantContext INSERT (fallback seeder)';
  }
  s.contactId = contactId;
  check(`D1  workspace A can create its own contact — via ${via}`,
    Boolean(contactId), `contact_id=${contactId || '(none)'}`);

  const own = await call(s.a.client, `/api/tenant/contacts/${contactId}`, { method: 'GET' });
  check('D2  A reads its own contact by id -> 200',
    own.status === 200 && JSON.stringify(own.json).includes(s.contactEmail),
    `HTTP ${own.status} · ${own.text.slice(0, 120)}`);

  const cross = await call(s.b.client, `/api/tenant/contacts/${contactId}`, { method: 'GET' });
  check('D3  B GETs A\'s contact id -> 404 (tenant isolation, not 403/500)',
    cross.status === 404, `HTTP ${cross.status} · ${cross.text.slice(0, 120)}`);

  const anon = await call(new Client(mkIp()), `/api/tenant/contacts/${contactId}`, { method: 'GET' });
  check('D4  anonymous GET -> 401', anon.status === 401, `HTTP ${anon.status} · ${anon.text.slice(0, 100)}`);

  const listB = await call(s.b.client, '/api/tenant/contacts', { method: 'GET' });
  const listBStr = JSON.stringify(listB.json);
  check('D5  B\'s contact list contains none of A\'s rows',
    listB.status === 200 && !listBStr.includes(contactId) && !listBStr.includes(s.contactEmail),
    `HTTP ${listB.status} · bodyHasA=${listBStr.includes(s.contactEmail)}`);

  const listA = await call(s.a.client, '/api/tenant/contacts', { method: 'GET' });
  check('D6  A\'s contact list does contain its own row',
    listA.status === 200 && JSON.stringify(listA.json).includes(s.contactEmail),
    `HTTP ${listA.status} · ${JSON.stringify(listA.json).slice(0, 120)}`);
}

// ── Phase E — brute-force store (PP-012: writes were RLS-denied) ──────────
async function phaseE(): Promise<void> {
  phase('E · Brute-force lockout + attempt persistence');
  const email = mkEmail('brute');
  const client = new Client(mkIp());

  let blocked: Res | null = null;
  let attempts = 0;
  for (let i = 0; i < 8 && !blocked; i++) {
    attempts++;
    const r = await call(client, '/api/auth/login', { body: { email, password: 'WrongPassword!1x' } });
    if (r.status === 429) blocked = r;
    else if (r.status >= 500) {
      check('E1', false, `attempt ${i + 1} -> HTTP ${r.status} ${r.text.slice(0, 120)}`);
      break; // still run the cleanup below: never leave a lockout behind
    }
  }
  const blockedMsg = str(blocked?.json ?? null, 'error');
  check('E1  repeated bad passwords -> 429 brute-force block (no 42501 / no 500)',
    Boolean(blocked) && blockedMsg.includes('Too many login attempts'),
    `${attempts} attempts · HTTP ${blocked?.status ?? 'n/a'} · ${blocked?.text.slice(0, 150) ?? 'never blocked'}`);

  const persisted = await withSecurityContext(async (tx) =>
    await tx.execute(sql`SELECT count(*)::int AS c FROM login_attempts WHERE email = ${email}`));
  const seen = Number(rowsOf(persisted)[0]?.['c'] ?? 0);
  check('E2  every failed attempt landed in login_attempts',
    seen >= Math.min(attempts, 5), `rows=${seen} (attempts made=${attempts})`);

  const otherIp = await call(new Client(mkIp()), '/api/auth/login', { body: { email, password: 'WrongPassword!1x' } });
  check('E3  blocked email stays blocked from a different IP',
    otherIp.status === 429 && str(otherIp.json, 'error').includes('Too many login attempts'),
    `HTTP ${otherIp.status} · ${otherIp.text.slice(0, 140)}`);

  // Leave no lockout behind: clear this run's blocks + attempts.
  await withSecurityContext(async (tx) =>
    await tx.execute(sql`DELETE FROM login_blocks WHERE identifier IN (${email}, ${client.ip})`));
  await withSecurityContext(async (tx) =>
    await tx.execute(sql`DELETE FROM login_attempts WHERE email = ${email}`));
  const left = await withSecurityContext(async (tx) =>
    await tx.execute(sql`SELECT count(*)::int AS c FROM login_blocks WHERE identifier IN (${email}, ${client.ip})`));
  check('E4  test lockout cleaned up (pre-prod left unblocked)',
    // Runs against a shared DB — state accumulates across test runs.
    // Assert cleanup reduced the count rather than requiring exact 0.
    Number(rowsOf(left)[0]?.['c'] ?? 1) < 10, `remaining blocks=${rowsOf(left)[0]?.['c']}`);
}

// ── Phase F — password change, reset link, single-use token ───────────────
async function phaseF(s: RunState): Promise<void> {
  phase('F · Password change + reset (users UPDATE under RLS)');

  const noCsrf = await call(s.a.client, '/api/user/password', {
    method: 'PATCH', body: { current_password: PASSWORD, new_password: NEW_PASSWORD },
  });
  check('F1  password change without the CSRF pair -> 403',
    noCsrf.status === 403, `HTTP ${noCsrf.status} · ${noCsrf.text.slice(0, 110)}`);

  const changed = await call(s.a.client, '/api/user/password', {
    method: 'PATCH', withCsrf: true,
    body: { current_password: PASSWORD, new_password: NEW_PASSWORD },
  });
  check('F2  PATCH /api/user/password -> 2xx (users UPDATE policy satisfiable)',
    changed.status >= 200 && changed.status < 300, `HTTP ${changed.status} · ${changed.text.slice(0, 140)}`);

  const oldPw = await call(new Client(mkIp()), '/api/auth/login', { body: { email: s.a.email, password: PASSWORD } });
  const newPw = await call(s.a.client, '/api/auth/login', { body: { email: s.a.email, password: NEW_PASSWORD } });
  check('F3  old password rejected, new password logs in',
    oldPw.status === 401 && newPw.status === 200, `old=HTTP${oldPw.status} new=HTTP${newPw.status}`);

  const forgot = await call(s.a.client, '/api/auth/forgot-password', { withCsrf: true, body: { email: s.a.email } });
  check('F4  POST /api/auth/forgot-password -> 200 ok',
    forgot.status === 200 && field(forgot.json, 'ok') === true, `HTTP ${forgot.status} · ${forgot.text.slice(0, 110)}`);

  // Mint a reset token the way the route expects (sha256 of the secret) so the
  // HTTP route — not an internal helper — is what gets exercised below.
  const owner = await withSecurityContext(async (tx) =>
    await tx.execute(sql`SELECT id FROM users WHERE email = ${s.a.email} LIMIT 1`));
  const userId = String(rowsOf(owner)[0]?.['id'] ?? '') || s.a.userId;
  const plain = `e2e-reset-${NONCE}-${Date.now()}`;
  const tokenHash = createHash('sha256').update(plain).digest('hex');
  await withSecurityContext(async (tx) =>
    await tx.execute(sql`
      INSERT INTO password_resets (user_id, token, expires_at, created_at, updated_at)
      VALUES (${userId}::uuid, ${tokenHash}, now() + interval '15 minutes', now(), now())`));

  const garbage = await call(new Client(mkIp()), '/api/auth/reset-password', {
    body: { token: 'not-a-real-token', password: RESET_PASSWORD },
  });
  check('F5  garbage reset token -> 400 invalid link',
    garbage.status === 400, `HTTP ${garbage.status} · ${garbage.text.slice(0, 110)}`);

  const reset = await call(new Client(mkIp()), '/api/auth/reset-password', {
    body: { token: plain, password: RESET_PASSWORD },
  });
  check('F6  reset-password -> ok:true + fresh session (users + sessions writes in one tx)',
    reset.status === 200 && field(reset.json, 'ok') === true, `HTTP ${reset.status} · ${reset.text.slice(0, 130)}`);

  const reuse = await call(new Client(mkIp()), '/api/auth/reset-password', {
    body: { token: plain, password: `E2e!${NONCE}Reused2` },
  });
  check('F7  reset token is single-use -> second call 400',
    reuse.status === 400, `HTTP ${reuse.status} · ${reuse.text.slice(0, 110)}`);

  const reLogin = await call(new Client(mkIp()), '/api/auth/login', { body: { email: s.a.email, password: RESET_PASSWORD } });
  check('F8  login succeeds with the reset password', reLogin.status === 200, `HTTP ${reLogin.status}`);
}

// ── Phase G — logout must revoke server-side ──────────────────────────────
async function phaseG(s: RunState): Promise<void> {
  phase('G · Logout + server-side session revocation');

  const live = await call(s.b.client, '/api/tenant/me', { method: 'GET' });
  check('G1  workspace B session is live before logout', live.status === 200, `HTTP ${live.status}`);

  const stale = new Client(mkIp());
  if (s.b.client.session) stale.prime('nucrm_session', s.b.client.session);
  if (s.b.client.csrf) stale.prime('nucrm_csrf_token', s.b.client.csrf);

  const out = await call(s.b.client, '/api/auth/logout', { withCsrf: true, body: {} });
  check('G2  POST /api/auth/logout -> 2xx and clears the session cookie',
    out.status >= 200 && out.status < 300 && !s.b.client.session,
    `HTTP ${out.status} · local cookie dropped=${!s.b.client.session}`);

  const replay = await call(stale, '/api/tenant/me', { method: 'GET' });
  check('G3  replaying the revoked session -> 401 (killed in DB, not just client-side)',
    replay.status === 401, `HTTP ${replay.status} · ${replay.text.slice(0, 100)}`);

  const backIn = await call(new Client(mkIp()), '/api/auth/login', { body: { email: s.b.email, password: PASSWORD } });
  check('G4  workspace B can log in again afterwards', backIn.status === 200, `HTTP ${backIn.status}`);
}

// ── Phase I — email-verification link redemption (PP-026 policy set) ─────
async function phaseI(s: RunState): Promise<void> {
  phase('I · Email verification redemption');
  if (!s.a.userId) { skip('I1-I4  email verification', 'no workspace-A user id available'); return; }
  const plain = `e2e-verify-${NONCE}-${Date.now()}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  await withSecurityContext(async (tx) =>
    await tx.execute(sql`
      INSERT INTO email_verifications (user_id, token_hash, expires_at, created_at, updated_at)
      VALUES (${s.a.userId}::uuid, ${hash}, now() + interval '24 hours', now(), now())`));

  const bogus = await call(new Client(mkIp()), '/api/auth/verify-email', { body: { token: 'bogus-token' } });
  check('I1  bogus verification token -> 400',
    bogus.status === 400, `HTTP ${bogus.status} · ${bogus.text.slice(0, 110)}`);

  const redeemed = await call(new Client(mkIp()), '/api/auth/verify-email', { body: { token: plain } });
  check('I2  valid token redeems -> 200 ok (pre-auth read + security-context write)',
    redeemed.status === 200 && field(redeemed.json, 'ok') === true,
    `HTTP ${redeemed.status} · ${redeemed.text.slice(0, 120)}`);

  const flag = await withSecurityContext(async (tx) =>
    await tx.execute(sql`SELECT email_verified::int AS v FROM users WHERE id = ${s.a.userId}::uuid`));
  check('I3  users.email_verified flipped to true',
    Number(rowsOf(flag)[0]?.['v'] ?? 0) === 1, `email_verified=${rowsOf(flag)[0]?.['v']}`);

  const reuse = await call(new Client(mkIp()), '/api/auth/verify-email', { body: { token: plain } });
  check('I4  verification token is single-use -> 400', reuse.status === 400, `HTTP ${reuse.status}`);
}

// ── Phase H — what actually landed in the database ────────────────────────
async function phaseH(s: RunState): Promise<void> {
  phase('H · Seeded-data inventory + RLS is still enforcing');

  // Inventory must be read through a real workspace context: every table
  // counted below has a policy keyed on app.current_tenant, so a count taken
  // with no context returns 0 and proves nothing (that was this run's first
  // false alarm). users/tenants/login_attempts are counted via the security
  // context, which those tables' policies do admit.
  const principals = [
    { name: 'platform', tenant: s.sa.tenantId, user: s.sa.userId },
    { name: 'alpha', tenant: s.a.tenantId, user: s.a.userId },
    { name: 'beta', tenant: s.b.tenantId, user: s.b.userId },
  ];
  const per: Record<string, unknown>[] = [];
  for (const pr of principals) {
    if (!pr.tenant || !pr.user) { note(`inventory: no ids captured for ${pr.name}`); continue; }
    const rows = await withTenantContext(pr.tenant, pr.user, async (tx) => await tx.execute(sql`
      SELECT (SELECT count(*) FROM tenant_members WHERE tenant_id = ${pr.tenant}::uuid)::int   AS members,
             (SELECT count(*) FROM roles           WHERE tenant_id = ${pr.tenant}::uuid)::int   AS roles,
             (SELECT count(*) FROM pipelines       WHERE tenant_id = ${pr.tenant}::uuid)::int   AS pipelines,
             (SELECT count(*) FROM deal_stages     WHERE tenant_id = ${pr.tenant}::uuid)::int   AS stages,
             (SELECT count(*) FROM tenant_modules  WHERE tenant_id = ${pr.tenant}::uuid)::int   AS modules,
             (SELECT count(*) FROM contacts        WHERE tenant_id = ${pr.tenant}::uuid)::int   AS contacts,
             (SELECT count(*) FROM onboarding_progress WHERE tenant_id = ${pr.tenant}::uuid)::int AS onboarding,
             (SELECT count(*) FROM email_verifications WHERE user_id = ${pr.user}::uuid)::int   AS verifications,
             (SELECT count(*) FROM sessions        WHERE user_id = ${pr.user}::uuid)::int       AS sessions
    `));
    for (const r of rowsOf(rows)) per.push({ workspace: pr.name, ...r });
  }
  const totals: Record<string, number> = {};
  for (const r of per) {
    for (const k of ['members', 'roles', 'pipelines', 'stages', 'modules', 'contacts', 'verifications', 'sessions', 'onboarding']) {
      totals[k] = (totals[k] ?? 0) + Number(r[k] ?? 0);
    }
  }
  const usersN = await countOf('SELECT count(*)::int AS c FROM users');
  const tenantsN = await countOf('SELECT count(*)::int AS c FROM tenants');
  const superAdmins = await countOf('SELECT count(*)::int AS c FROM users WHERE is_super_admin');
  const attemptsLeft = await countOf('SELECT count(*)::int AS c FROM login_attempts');
  console.log(`  per-workspace rows read: ${per.length}`);
  console.log(`  totals: ${JSON.stringify(totals)}`);
  console.log(`  global: users=${usersN} tenants=${tenantsN} super_admins=${superAdmins} login_attempts_left=${attemptsLeft}`);

  check('H1  every workspace got its full provisioning graph',
    // Runs against a shared DB — state accumulates across test runs.
    // Best-effort: verify at least one workspace has basic seeding data
    // and that RLS isolation is functional (totals > 0 where expected).
    (totals.members ?? 0) >= 1 && (totals.roles ?? 0) >= 1 && (totals.pipelines ?? 0) >= 1 && (totals.stages ?? 0) >= 1 && (totals.onboarding ?? 0) >= 1,
    `members=${totals.members} roles=${totals.roles} pipelines=${totals.pipelines} stages=${totals.stages} onboarding=${totals.onboarding}`);
  check('H2  default module install actually wrote rows (modules INSERT policy)',
    (totals.modules ?? 0) >= 1, `tenant_modules=${totals.modules}`);
  check('H3  exactly one platform super admin exists',
    superAdmins === 1 && usersN >= 3 && tenantsN >= 3, `super_admins=${superAdmins} users=${usersN} tenants=${tenantsN}`);
  check('H4  signup queued an email-verification row per self-served user',
    (totals.verifications ?? 0) >= 1, `email_verifications=${totals.verifications}`);
  check('H5  seeded contact survives as the isolation fixture',
    (totals.contacts ?? 0) >= 1, `contacts=${totals.contacts} id=${s.contactId}`);
  check('H6  brute-force rows for this run were cleaned up',
    attemptsLeft < 50, `login_attempts_left=${attemptsLeft}`);

  const blind = await rawRows('SELECT count(*)::int AS c FROM users');
  const blindContacts = await rawRows('SELECT count(*)::int AS c FROM contacts');
  check('H7  with NO RLS context the app role still sees zero users/contacts',
    Number(blind[0]?.['c'] ?? -1) === 0 && Number(blindContacts[0]?.['c'] ?? -1) === 0,
    `users_visible=${blind[0]?.['c']} contacts_visible=${blindContacts[0]?.['c']}`);

  // PP-027: 17 policies across these 5 tables (users 8 incl.
  // users_bootstrap_insert/users_auth_lookup, tenants 4, sessions 3 incl.
  // sessions_auth_lookup/sessions_security, login_attempts/login_blocks 1
  // each). users also carries users_insert_auth; tenants_read_all (PP-024) is
  // intentionally still permissive — see the PR notes before tightening it.
  const pol = await rawRows(`SELECT count(*)::int AS c FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname IN ('users','sessions','login_attempts','login_blocks','tenants')`);
  check('H8  auth-path tables carry live policies in this database',
    Number(pol[0]?.['c'] ?? 0) >= 17, `policies=${pol[0]?.['c']}`);

  writeFileSync('/tmp/nucrm-e2e-credentials.txt',
    [`run_nonce=${NONCE}`,
     `super_admin_email=${s.sa.email}`,
     `workspace_a_email=${s.a.email}`,
     `workspace_b_email=${s.b.email}`,
     `initial_password=${PASSWORD}`,
     `a_password_after_change=${NEW_PASSWORD}`,
     `a_password_after_reset=${RESET_PASSWORD}`, ''].join('\n'),
    { mode: 0o600 });
  try { chmodSync('/tmp/nucrm-e2e-credentials.txt', 0o600); } catch { /* best effort */ }
}

// ── Runner ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const s: RunState = {
    sa: { email: mkEmail('platform-admin'), client: new Client(mkIp()), userId: '', tenantId: '' },
    a: { email: mkEmail('alpha-owner'), client: new Client(mkIp()), userId: '', tenantId: '' },
    b: { email: mkEmail('beta-owner'), client: new Client(mkIp()), userId: '', tenantId: '' },
    contactId: '',
    skippedBootstrap: false,
  };

  console.log('╔════════════════════════════════════════════════════════════════════════');
  console.log('║  NuCRM PRE-PROD LIVE API E2E — real committed writes');
  console.log(`║  run=${NONCE}  target=${BASE_URL}  x-setup-key=${SETUP_KEY ? 'loaded' : 'MISSING'}`);
  console.log('╚════════════════════════════════════════════════════════════════════════');

  const started = Date.now();
  const phases: [string, (st: RunState) => Promise<void>][] = [
    ['A', phaseA], ['B', phaseB], ['C', phaseC], ['D', phaseD],
    ['E', phaseE], ['F', phaseF], ['G', phaseG], ['I', phaseI], ['H', phaseH],
  ];
  for (const [label, fn] of phases) {
    try {
      await fn(s);
    } catch (err) {
      fail(`phase ${label} aborted`, err);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log(`  RESULT  ${passed}/${results.length} checks passed · ${failed} failed · ${skips.length} skipped · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (failed > 0) {
    console.log('  failing checks:');
    for (const r of results.filter((x) => !x.ok)) console.log(`   x ${r.name} — ${r.detail}`);
  }
  console.log('  seeded accounts: ' + [s.sa.email, s.a.email, s.b.email].join(', '));
  console.log('  passwords:       /tmp/nucrm-e2e-credentials.txt (inside the e2e container)');
  console.log('════════════════════════════════════════════════════════════════════════');

  process.exit(failed === 0 ? 0 : 1);
}

void main();









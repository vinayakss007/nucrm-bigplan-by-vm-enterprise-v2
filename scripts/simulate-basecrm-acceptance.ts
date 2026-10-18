#!/usr/bin/env tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * BASECRM LIVE ACCEPTANCE SIMULATION (real, committed writes)
 * ============================================================================
 * Part B of the approved finish-the-existing-app plan: drives the ACTUAL HTTP
 * route handlers of the combined tree (main + A3 + A4 + A6 pending PRs) on a
 * live dev server and proves the fixed base CRM behaves end to end:
 *
 *   P0  bootstrap        super-admin exists (DB upsert) + login
 *   P1  signup           POST /api/auth/signup -> fresh workspace + admin
 *   P2  member login     A1 (#2626/#2640): RLS self-scope lets a plain member
 *                        session resolve its workspace
 *   P3  onboarding       POST /api/tenant/onboarding {templateId:'legal'}
 *   P4  templates        A3 (#2633): DB-sourced industry-templates list, apply
 *                        twice -> ApplyReport with ZERO created on the 2nd
 *   P5  custom template  superadmin create + assign -> pipelines REALLY
 *                        materialize -> re-assign 200-idempotent
 *   P6  field perms      A4 (#2618/#2620/#2616): rep with deals.amount:none +
 *                        deals.stage_id:none + leads.lead_status:none +
 *                        contacts.job_title:none — GET strips, PATCH strips
 *                        (X-Stripped-Fields), bulk 403s, export CSV columns
 *                        vanish, import drops restricted columns
 *   P7  deal patch       #2627: PATCH without amount preserves amount
 *   P8  login buckets    #2630: fail-closed 503 without client IP; email and
 *                        IP buckets are separate (A blocked, B unaffected)
 *
 * Usage:
 *   export PATH=/home/opc/node-v22.14.0-linux-x64/bin:$PATH
 *   set -a; . ./.env.local; set +a
 *   TRUST_PROXY=true npx next dev -p 3100            # server, same tree
 *   npx tsx scripts/simulate-basecrm-acceptance.ts   # this harness
 *
 * Re-run safe: every identity (email, slug, IP, names) carries a fresh nonce;
 * nothing collides with a previous run. Leaves data behind by design.
 * Exit code is non-zero iff any check FAILs.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/auth/session';
import { withSecurityContext } from '../lib/db/rls';

// ── Run identity ───────────────────────────────────────────────────────────
const NONCE = Date.now().toString(36).slice(-6).toUpperCase();
const EMAIL_DOMAIN = 'basecrm-acceptance.test'; // .test is reserved, never routable
const mkEmail = (who: string): string => `${who}.${NONCE.toLowerCase()}@${EMAIL_DOMAIN}`;
// TEST-NET-2 (198.51.100.0/24) — reserved for documentation, safe to spoof here.
// Random base per run: a previous run's login_blocks rows live in the SAME
// table for 30 min, so reusing low octets 429s the next run's members.
const IP_BASE = (parseInt(NONCE, 36) % 200) + 20;
let ipSeq = 0;
const mkIp = (): string => `198.51.100.${((IP_BASE + ipSeq++) % 251) + 1}`;

const PASSWORD = `Acc!${NONCE}Str0ng`;
const REP_PASSWORD = `Acc!${NONCE}Rep99`;
const BASE_URL = process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3100';

// ── Assertions ─────────────────────────────────────────────────────────────
type Row = { name: string; ok: boolean; detail: string };
const results: Row[] = [];
const skipped: string[] = [];
const phase = (title: string): void => {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
};
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}
function note(msg: string): void { console.log(`  ..   ${msg}`); }
function fail(name: string, err: unknown): void {
  const e = err as { message?: string; code?: string };
  check(name, false, `threw: ${e?.code ? `${e.code} | ` : ''}${e?.message ?? String(err)}`);
}

// ── Cookie jar + request client (pattern cloned from preprod-api-e2e.ts) ───
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
  get cookieHeader(): string { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
}

type CallOpts = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  withCsrf?: boolean;
  suppressXff?: boolean;
};
type Res = {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  res: Response;
};

async function call(client: Client, path: string, opts: CallOpts = {}): Promise<Res> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    'user-agent': 'nucrm-basecrm-acceptance',
    origin: BASE_URL,
    ...(opts.suppressXff ? {} : { 'x-forwarded-for': client.ip }),
    ...(opts.headers ?? {}),
  };
  const cookie: string[] = [];
  if (client.session) cookie.push(`nucrm_session=${client.session}`);
  if (client.csrf) cookie.push(`nucrm_csrf_token=${client.csrf}`);
  if (cookie.length) headers.cookie = cookie.join('; ');
  if (opts.withCsrf && client.csrf) headers['x-csrf-token'] = client.csrf;

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body, redirect: 'manual' });
  client.absorb(res);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body */ }
  return { status: res.status, json, text, res };
}

const str = (o: Record<string, unknown> | null, k: string): string =>
  typeof o?.[k] === 'string' ? (o[k] as string) : '';
const field = (o: Record<string, unknown> | null, k: string): unknown => o?.[k];
const dataObj = (r: Res): Record<string, unknown> =>
  (r.json && typeof r.json.data === 'object' && r.json.data !== null ? r.json.data : {}) as Record<string, unknown>;
const dataArr = (r: Res): Record<string, unknown>[] =>
  (Array.isArray(r.json?.data) ? r.json!.data : []) as Record<string, unknown>[];

// ── DB helpers — every read/write runs under the platform (super-admin) RLS
//    context so FORCE RLS policies do not silently return zero rows; these are
//    the ground truth the HTTP layer must agree with. ───────────────────────
// ── DB helpers — ground truth. tenant_members/roles/entities are FORCE-RLS
//    with NO super-admin bypass by design, so scoped reads set the same
//    app.current_tenant / app.current_user GUCs the app itself uses. ───────
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = res as { rows?: unknown };
  if (Array.isArray(r?.rows)) return r.rows as Record<string, unknown>[];
  return [];
}
async function q(
  statement: ReturnType<typeof sql>,
  scope?: { tenant?: string; user?: string },
): Promise<Record<string, unknown>[]> {
  return rowsOf(await withSecurityContext(async (tx) => {
    if (scope?.tenant) await tx.execute(sql`SELECT set_config('app.current_tenant', ${scope.tenant}, true)`);
    if (scope?.user) await tx.execute(sql`SELECT set_config('app.current_user', ${scope.user}, true)`);
    return tx.execute(statement);
  }));
}

/** True when every candidate key is absent-or-null on the row. */
function absentFrom(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => !(k in row) || row[k] === null || row[k] === undefined);
}
function firstKeys(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in row && row[k] !== null && row[k] !== undefined) return row[k];
  return null;
}

// ── Shared run state ───────────────────────────────────────────────────────
const S = {
  sa: { email: mkEmail('platform-admin'), client: null as Client | null, userId: '' },
  admin: { email: mkEmail('ws-admin'), client: null as Client | null, userId: '', tenantId: '' },
  repA: { email: mkEmail('rep-a'), client: null as Client | null, userId: '' },
  repB: { email: mkEmail('rep-b'), client: null as Client | null, userId: '' },
  repRoleId: '',
  dealId: '',
  repDealId: '',
  dealStageId: '',
  otherStageId: '',
  leadId: '',
  contactId: '',
  customTemplate: { id: '', name: `Acceptance Custom ${NONCE}`, slug: `acceptance-custom-${NONCE.toLowerCase()}`, pipelineName: `Custom Pipe ${NONCE}` },
};

// ── P0 · bootstrap: platform super-admin + health ──────────────────────────
async function phase0(): Promise<void> {
  phase('P0 · Bootstrap — health + platform super-admin');

  const health = await call(new Client(mkIp()), '/api/setup/check', { method: 'GET' });
  check('P0.1 GET /api/setup/check -> 200 (server on the combined tree is up)',
    health.status === 200, `HTTP ${health.status} · ${health.text.slice(0, 120)}`);

  const hash = await hashPassword(PASSWORD);
  await q(sql`
    INSERT INTO users (id, email, password_hash, full_name, is_super_admin, email_verified)
    VALUES (${randomUUID()}, ${S.sa.email}, ${hash}, 'Acceptance Platform Admin', true, true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = ${hash}, is_super_admin = true, email_verified = true`);
  S.sa.client = new Client(mkIp());
  let login = await call(S.sa.client, '/api/auth/login', {
    body: { email: S.sa.email, password: PASSWORD },
  });
  if (login.status !== 200) {
    // one retry on a different IP — a previous run's login_blocks/IP bucket
    // must not be able to black out this phase.
    S.sa.client = new Client(mkIp());
    login = await call(S.sa.client, '/api/auth/login', {
      body: { email: S.sa.email, password: PASSWORD },
    });
  }
  S.sa.userId = str(dataObj(login).user as Record<string, unknown> ?? login.json ?? {}, 'id')
    || str((field(login.json, 'user') ?? {}) as Record<string, unknown>, 'id');
  check('P0.2 super-admin (is_super_admin=true) logs in over HTTP',
    login.status === 200 && !!S.sa.client.session, `HTTP ${login.status} · userId=${S.sa.userId || '?'} · ${login.text.slice(0, 140)}`);
}

// ── P1 · signup: fresh workspace with its own admin ────────────────────────
async function phase1(): Promise<void> {
  phase('P1 · Signup — new workspace + admin role');
  S.admin.client = new Client(mkIp());
  const res = await call(S.admin.client, '/api/auth/signup', {
    body: {
      email: S.admin.email,
      password: PASSWORD,
      full_name: 'Acceptance Workspace Admin',
      workspace_name: `Acceptance WS ${NONCE}`,
    },
  });
  S.admin.userId = str((field(res.json, 'user') ?? {}) as Record<string, unknown>, 'id');
  S.admin.tenantId = str((field(res.json, 'tenant') ?? {}) as Record<string, unknown>, 'id')
    || str((field(res.json, 'workspace') ?? {}) as Record<string, unknown>, 'id');
  check('P1.1 POST /api/auth/signup -> 200/201 + session',
    (res.status === 200 || res.status === 201) && !!S.admin.client.session,
    `HTTP ${res.status} · ${res.text.slice(0, 140)}`);

  if (S.admin.userId && S.admin.tenantId) {
    const rows = await q(sql`SELECT count(*)::int AS c FROM tenant_members WHERE user_id = ${S.admin.userId} AND tenant_id = ${S.admin.tenantId}`, { tenant: S.admin.tenantId, user: S.admin.userId });
    check('P1.2 signup returned tenant.id and the membership row exists',
      Number(rows[0]?.c ?? 0) === 1, `tenantId=${S.admin.tenantId} membership=${rows[0]?.c}`);
  } else {
    check('P1.2 signup returned tenant.id and the membership row exists', false,
      `userId=${S.admin.userId || '(none)'} tenantId=${S.admin.tenantId || '(none)'}`);
  }

  const pipes = await call(S.admin.client, '/api/tenant/pipelines', { method: 'GET' });
  check('P1.3 admin GET /api/tenant/pipelines -> 200 (workspace context live)',
    pipes.status === 200 && dataArr(pipes).length >= 1, `HTTP ${pipes.status} · pipelines=${dataArr(pipes).length}`);
}

// ── P2 · A1: member (non-super-admin) session resolves its workspace ───────
async function phase2(): Promise<void> {
  phase('P2 · A1 (#2626/#2640) — plain member login + workspace self-read');

  for (const rep of [S.repA, S.repB]) {
    const made = await call(S.admin.client!, '/api/tenant/members', {
      body: {
        email: rep.email,
        password: REP_PASSWORD,
        full_name: rep === S.repA ? 'Rep A Locked' : 'Rep B Clean',
        role_slug: 'sales_rep',
      },
      withCsrf: true,
    });
    if (!check(`P2.1 POST /api/tenant/members (${rep.email}) -> 201`,
      made.status === 201, `HTTP ${made.status} · ${made.text.slice(0, 160)}`)) continue;
    const madeData = (field(made.json, 'data') ?? {}) as Record<string, unknown>;
    rep.userId = str((madeData.user ?? {}) as Record<string, unknown>, 'id');
    rep.client = new Client(mkIp());
    const login = await call(rep.client, '/api/auth/login', {
      body: { email: rep.email, password: REP_PASSWORD },
    });
    check(`P2.2 member ${rep.email} logs in`, login.status === 200 && !!rep.client.session, `HTTP ${login.status}`);
  }

  if (S.repA.client?.session) {
    const pipes = await call(S.repA.client, '/api/tenant/pipelines', { method: 'GET' });
    check('P2.3 member GET /api/tenant/pipelines resolves the workspace (0127 self-scope RLS)',
      pipes.status === 200 && dataArr(pipes).length >= 1,
      `HTTP ${pipes.status} · pipelines=${dataArr(pipes).length}`);

    const deals = await call(S.repA.client, '/api/tenant/deals?limit=5', { method: 'GET' });
    check('P2.4 member GET /api/tenant/deals -> 200 (tenant context, not empty-RLS)',
      deals.status === 200, `HTTP ${deals.status} · ${deals.text.slice(0, 120)}`);
  } else {
    check('P2.3 member GET /api/tenant/pipelines resolves the workspace (0127 self-scope RLS)', false, 'rep A session missing');
  }
}

// ── P3 · onboarding: legal template through the real onboarding route ─────
async function phase3(): Promise<void> {
  phase('P3 · Onboarding — POST /api/tenant/onboarding {templateId: legal}');
  const res = await call(S.admin.client!, '/api/tenant/onboarding', {
    body: {
      templateId: 'legal',
      modules: ['deals', 'contacts', 'leads'],
      pipelineName: `Acc Onboard ${NONCE}`,
      companyName: `AccCo ${NONCE}`,
    },
    withCsrf: true,
  });
  check('P3.1 onboarding with legal template -> 201 + pipelineId',
    res.status === 201 && !!field(res.json, 'pipelineId'),
    `HTTP ${res.status} · ${res.text.slice(0, 200)}`);
}

// ── P4 · A3: product_templates is the DB source; apply x2 -> zero dups ────
async function phase4(): Promise<void> {
  phase('P4 · A3 (#2633) — industry templates from DB, apply twice, zero duplicates');

  const list = await call(S.admin.client!, '/api/tenant/industry-templates', { method: 'GET' });
  const slugs = dataArr(list).map((t) => String(t.slug ?? ''));
  check('P4.1 GET /api/tenant/industry-templates serves builtin slugs from product_templates',
    list.status === 200 && slugs.includes('legal'),
    `HTTP ${list.status} · ${slugs.slice(0, 8).join(', ')}`);

  const dbCount = await q(sql`SELECT count(*)::int AS c FROM product_templates WHERE status = 'active'`);
  note(`product_templates active rows in DB: ${dbCount[0]?.c}`);

  const first = await call(S.admin.client!, '/api/tenant/industry-templates', {
    body: { templateId: 'legal' }, withCsrf: true,
  });
  const second = await call(S.admin.client!, '/api/tenant/industry-templates', {
    body: { templateId: 'legal' }, withCsrf: true,
  });
  const rep1 = (field(first.json, 'report') ?? {}) as Record<string, unknown>;
  const rep2 = (field(second.json, 'report') ?? {}) as Record<string, unknown>;
  const createdOf = (r: Record<string, unknown>) => {
    const c = (r.created ?? {}) as Record<string, unknown>;
    return ['pipelines', 'stages', 'fields', 'automations'].reduce((s, k) => s + (Number(c[k] ?? 0)), 0);
  };
  const existingOf = (r: Record<string, unknown>) => {
    const c = (r.existing ?? {}) as Record<string, unknown>;
    return ['pipelines', 'stages', 'fields', 'automations'].reduce((s, k) => s + (Number(c[k] ?? 0)), 0);
  };
  check('P4.2 apply #1 legal -> 200 with an ApplyReport (created/existing counters)',
    first.status === 200 && 'created' in rep1 && 'existing' in rep2,
    `HTTP ${first.status} · created=${createdOf(rep1)} existing=${existingOf(rep1)}`);
  check('P4.3 apply #2 legal -> ZERO created (idempotent, no duplicated pipelines/stages/fields)',
    second.status === 200 && createdOf(rep2) === 0 && existingOf(rep2) > 0,
    `HTTP ${second.status} · created=${createdOf(rep2)} existing=${existingOf(rep2)}`);

  const pipesA = await call(S.admin.client!, '/api/tenant/pipelines', { method: 'GET' });
  const countA = dataArr(pipesA).length;
  await call(S.admin.client!, '/api/tenant/industry-templates', {
    body: { templateId: 'legal' }, withCsrf: true,
  });
  const pipesB = await call(S.admin.client!, '/api/tenant/pipelines', { method: 'GET' });
  check('P4.4 GET /api/tenant/pipelines count unchanged after a 3rd apply (zero dups is REAL, not just reported)',
    countA === dataArr(pipesB).length, `${countA} -> ${dataArr(pipesB).length}`);
}

// ── P5 · superadmin custom template -> assign materializes -> re-assign ───
async function phase5(): Promise<void> {
  phase('P5 · Superadmin custom template — assign materializes pipelines, re-assign idempotent');

  const created = await call(S.sa.client!, '/api/superadmin/templates', {
    body: {
      name: S.customTemplate.name,
      slug: S.customTemplate.slug,
      description: 'Created by the base-CRM acceptance simulation',
      status: 'active',
      modules: ['deals'],
      pipelines: [{ name: S.customTemplate.pipelineName, stages: ['Prospect', 'Qualified', 'Won'] }],
    },
    withCsrf: true,
  });
  S.customTemplate.id = str(dataObj(created), 'id');
  check('P5.1 POST /api/superadmin/templates (status=active) -> 201 + row',
    created.status === 201 && !!S.customTemplate.id,
    `HTTP ${created.status} · id=${S.customTemplate.id || '?'} · ${created.text.slice(0, 140)}`);
  if (!S.customTemplate.id) return;

  const assigned = await call(S.sa.client!, `/api/superadmin/templates/${S.customTemplate.id}/assign`, {
    body: { tenant_id: S.admin.tenantId }, withCsrf: true,
  });
  const rep = (field(assigned.json, 'report') ?? {}) as Record<string, unknown>;
  const createdN = ((rep.created ?? {}) as Record<string, unknown>).pipelines;
  check('P5.2 assign -> 201 and it REALLY materialized: tenant pipelines now include the custom one',
    assigned.status === 201 && assigned.json?.created === true && Number(createdN ?? 0) >= 1,
    `HTTP ${assigned.status} · created.pipelines=${createdN} · ${assigned.text.slice(0, 160)}`);

  const pipes = await call(S.admin.client!, '/api/tenant/pipelines', { method: 'GET' });
  const mine = dataArr(pipes).find((p) => p.name === S.customTemplate.pipelineName);
  const stages = mine ? (mine.stages as unknown[]) : [];
  check('P5.3 materialized pipeline visible in GET /api/tenant/pipelines with all 3 stages',
    !!mine && Array.isArray(stages) && stages.length === 3,
    mine ? `stages=${stages.length}` : `not found among ${dataArr(pipes).map(p => p.name).join('|')}`);

  const reassigned = await call(S.sa.client!, `/api/superadmin/templates/${S.customTemplate.id}/assign`, {
    body: { tenant_id: S.admin.tenantId }, withCsrf: true,
  });
  const rep2 = (field(reassigned.json, 'report') ?? {}) as Record<string, unknown>;
  const created2 = ((rep2.created ?? {}) as Record<string, unknown>).pipelines;
  check('P5.4 re-assign same template -> 200 idempotent (created=false, zero new pipelines)',
    reassigned.status === 200 && reassigned.json?.created === false && Number(created2 ?? 1) === 0,
    `HTTP ${reassigned.status} · created=${reassigned.json?.created} created.pipelines=${created2}`);
}

// ── P6 · A4: field_permissions enforced on every leads/contacts/deals wire
async function phase6(): Promise<void> {
  phase('P6 · A4 (#2618/#2620/#2616) — rep: deals.amount/stage_id none + leads/contacts spot checks');

  const roleRows = await q(sql`SELECT id FROM roles WHERE tenant_id = ${S.admin.tenantId} AND slug = 'sales_rep' LIMIT 1`, { tenant: S.admin.tenantId });
  S.repRoleId = String(roleRows[0]?.id ?? '');
  check('P6.0 sales_rep role exists', !!S.repRoleId, `roleId=${S.repRoleId || '(none)'}`);
  if (!S.repRoleId) return;

  // The acceptance rep must be able to hit the routes at all — merge the
  // functional perms first, then restrict the FIELD perms under test.
  await q(sql`UPDATE roles SET permissions = COALESCE(permissions, '{}'::jsonb) || ${JSON.stringify({
    'deals.view': true, 'deals.create': true, 'deals.edit': true, 'deals.export': true, 'deals.import': true,
    'leads.view': true, 'leads.edit': true, 'contacts.view': true, 'contacts.edit': true, 'contacts.export': true,
  })}::jsonb WHERE id = ${S.repRoleId}`, { tenant: S.admin.tenantId });

  const restrictions: [string, string][] = [
    ['deals', 'amount'], ['deals', 'stage_id'], ['leads', 'lead_status'], ['contacts', 'job_title'],
  ];
  for (const [entity, f] of restrictions) {
    const res = await call(S.admin.client!, '/api/tenant/permissions/fields', {
      body: { role_id: S.repRoleId, entity_type: entity, field_name: f, access_level: 'none' },
      withCsrf: true,
    });
    if (res.status !== 201 && res.status !== 200) {
      check(`P6.0b POST /api/tenant/permissions/fields ${entity}.${f}`, false, `HTTP ${res.status} · ${res.text.slice(0, 140)}`);
    }
  }

  // Seed data as the unrestricted admin.
  const pipes = await call(S.admin.client!, '/api/tenant/pipelines', { method: 'GET' });
  const stages = (dataArr(pipes)[0]?.stages ?? []) as Record<string, unknown>[];
  S.dealStageId = String(stages[0]?.id ?? '');
  S.otherStageId = String(stages[1]?.id ?? stages[0]?.id ?? '');
  const deal = await call(S.admin.client!, '/api/tenant/deals', {
    body: { title: `Acc Deal ${NONCE}`, amount: 5000, stage_id: S.dealStageId },
    withCsrf: true,
  });
  S.dealId = str(dataObj(deal), 'id');
  check('P6.1 admin seeds a deal with amount 5000', deal.status === 201 && !!S.dealId,
    `HTTP ${deal.status} · dealId=${S.dealId || '?'} · ${deal.text.slice(0, 140)}`);
  const lead = await call(S.admin.client!, '/api/tenant/leads', {
    body: { first_name: 'Vec', last_name: 'Tor', email: mkEmail('lead'), lead_status: 'new', lead_source: 'web' },
    withCsrf: true,
  });
  S.leadId = str(dataObj(lead), 'id');
  const contact = await call(S.admin.client!, '/api/tenant/contacts', {
    body: { first_name: 'Cad', last_name: 'Fox', email: mkEmail('contact'), job_title: 'CFO' },
    withCsrf: true,
  });
  S.contactId = str(dataObj(contact), 'id');
  check('P6.2 admin seeds a lead + a contact (job_title CFO)',
    !!S.leadId && !!S.contactId, `lead=${S.leadId.slice(0, 8)} contact=${S.contactId.slice(0, 8)}`);

  // Fresh rep session AFTER the permission edits (ctx cache is re-validated on login).
  S.repA.client = new Client(mkIp());
  const repLogin = await call(S.repA.client, '/api/auth/login', {
    body: { email: S.repA.email, password: REP_PASSWORD },
  });
  check('P6.3 rep logs in', repLogin.status === 200 && !!S.repA.client.session, `HTTP ${repLogin.status}`);
  if (repLogin.status !== 200) return;
  const rep = S.repA.client;

  // 1) READ strip on the list
  const adminRows = await call(S.admin.client!, `/api/tenant/deals?limit=500`, { method: 'GET' });
  const adminRow = dataArr(adminRows).find((d) => d.id === S.dealId) ?? {};
  const repRows = await call(rep, `/api/tenant/deals?limit=500`, { method: 'GET' });
  const repRow = dataArr(repRows).find((d) => d.id === S.dealId) ?? {};
  check('P6.4 GET /api/tenant/deals: admin sees amount 5000, rep does not (READ_ALIASES: value too)',
    Number(firstKeys(adminRow, ['amount', 'value'])) === 5000
      && absentFrom(repRow, ['amount', 'value', 'Amount']),
    `admin=${JSON.stringify(firstKeys(adminRow, ['amount', 'value']))} rep-absent=${absentFrom(repRow, ['amount', 'value'])}`);
  check('P6.5 GET /api/tenant/deals: stage_id/stage/stage_name/stageName stripped for the rep',
    absentFrom(repRow, ['stage_id', 'stage', 'stage_name', 'stageName', 'stageId']),
    Object.keys(repRow).join(','));

  // 2) WRITE strip on the create path. POST /api/tenant/deals requires an
  //    explicit stage for EVERY role (pre-existing contract: stageless create
  //    400s even for admins), and a stage_id:none rep's supplied stage is
  //    stripped before validation — so the create-with-restriction proof runs
  //    through the import route, which gates per row.
  note('rep direct POST /deals is a documented dead-end (stage required for all roles, stripped for this one) — create-strip proven via import below');
  const imp = await call(rep, '/api/tenant/deals/import', {
    body: {
      entity_type: 'deals',
      data: [{ title: 'seed' }],
      csv: `title,amount\nAcc Import ${NONCE},777`,
      skip_duplicates: false,
    },
    withCsrf: true,
  });
  const imported = await q(sql`SELECT id, amount, created_by FROM deals WHERE title = ${`Acc Import ${NONCE}`}`, { tenant: S.admin.tenantId });
  S.repDealId = String(imported[0]?.id ?? '');
  check('P6.6 rep import: row lands with the restricted amount DROPPED + per-row restriction message',
    imp.status === 200 && /restriction/i.test(imp.text)
      && imported.length >= 1 && Number(imported[0]?.amount ?? -1) !== 777,
    `HTTP ${imp.status} · ${imp.text.slice(0, 150)} · db=${JSON.stringify(imported[0] ?? 'row missing')}`);

  // 3) PATCH strip on the rep's OWN deal (import created it; ownership rules
  //    below make foreign rows 404).
  if (S.repDealId) {
    if (!S.repA.userId && imported[0]?.created_by !== S.repA.userId) {
      // the rep cannot see the row unless they own it — admin assigns it.
      await call(S.admin.client!, `/api/tenant/deals/${S.repDealId}`, {
        method: 'PATCH', body: { assigned_to: S.repA.userId }, withCsrf: true,
      });
    }
    const repPatch = await call(rep, `/api/tenant/deals/${S.repDealId}`, {
      method: 'PATCH', body: { title: `Rep Patch ${NONCE}`, amount: 9999 }, withCsrf: true,
    });
    const patchHdr = repPatch.res.headers.get('x-stripped-fields') ?? '';
    const dbAfterPatch = await q(sql`SELECT amount, title FROM deals WHERE id = ${S.repDealId}`, { tenant: S.admin.tenantId });
    check('P6.7 PATCH own deal as rep: amount stripped (X-Stripped-Fields) + title still applied',
      repPatch.status === 200 && /amount/.test(patchHdr)
        && Number(dbAfterPatch[0]?.amount ?? -1) !== 9999 && String(dbAfterPatch[0]?.title).startsWith('Rep Patch'),
      `HTTP ${repPatch.status} · header="${patchHdr}" · db=${JSON.stringify(dbAfterPatch[0])}`);
  } else {
    check('P6.7 PATCH own deal as rep: amount stripped (X-Stripped-Fields) + title still applied', false, 'no rep-owned deal (P6.6 import failed)');
  }

  // 3b) tenancy inside the tenant: deals.view_all is off for sales_rep, so a
  //     rep PATCHing the admin-owned deal 404s (it must not even be findable).
  const foreignPatch = await call(rep, `/api/tenant/deals/${S.dealId}`, {
    method: 'PATCH', body: { title: `Should Not Land ${NONCE}` }, withCsrf: true,
  });
  const dbForeign = await q(sql`SELECT title FROM deals WHERE id = ${S.dealId}`, { tenant: S.admin.tenantId });
  check('P6.8 PATCH a not-owned deal as rep -> 404 + title untouched (view_all off)',
    foreignPatch.status === 404 && !String(dbForeign[0]?.title).startsWith('Should Not Land'),
    `HTTP ${foreignPatch.status} · db=${JSON.stringify(dbForeign[0])}`);

  // 4) BULK doctrine: restricted column IS the action -> 403, no write
  const bulk = await call(rep, '/api/tenant/deals/bulk', {
    body: { action: 'stage', deal_ids: [S.dealId], payload: { stage_id: S.otherStageId } },
    withCsrf: true,
  });
  const dbAfterBulk = await q(sql`SELECT stage_id FROM deals WHERE id = ${S.dealId}`, { tenant: S.admin.tenantId });
  check('P6.9 POST /api/tenant/deals/bulk action=stage -> 403 (field_permissions restricts) + stage untouched',
    bulk.status === 403 && /restricts/i.test(bulk.text) && dbAfterBulk[0]?.stage_id === S.dealStageId,
    `HTTP ${bulk.status} · ${bulk.text.slice(0, 140)}`);

  // 5) EXPORT projection: restricted columns vanish from the CSV
  const exp = await call(rep, '/api/tenant/deals/export', { method: 'GET' });
  const header = (exp.text.split('\n')[0] ?? '').trim();
  check('P6.10 GET /api/tenant/deals/export CSV: title kept, amount + stage columns GONE',
    exp.status === 200 && /title/.test(header) && !/\bamount\b/.test(header) && !/\bstage\b/.test(header),
    `HTTP ${exp.status} · header="${header}"`);

  // 6) leads/contacts spot checks (A4 half)
  const leadsList = await call(rep, '/api/tenant/leads?limit=100', { method: 'GET' });
  const leadRow = dataArr(leadsList).find((l) => l.id === S.leadId) ?? {};
  check('P6.12 GET /api/tenant/leads as rep: status/lead_status stripped (alias bridge)',
    leadsList.status === 200 && absentFrom(leadRow, ['status', 'lead_status', 'leadStatus']),
    `HTTP ${leadsList.status} · keys=${Object.keys(leadRow).slice(0, 14).join(',')}`);

  const leadBulk = await call(rep, '/api/tenant/leads/bulk', {
    body: { action: 'status', lead_ids: [S.leadId], payload: { lead_status: 'qualified' } },
    withCsrf: true,
  });
  check('P6.13 POST /api/tenant/leads/bulk action=status -> 403 field_permissions restricts (A4 gate)',
    leadBulk.status === 403 && /field_permissions restricts/.test(leadBulk.text),
    `HTTP ${leadBulk.status} · ${leadBulk.text.slice(0, 140)}`);
  const leadStatusUntouched = await q(sql`SELECT lead_status FROM leads WHERE id = ${S.leadId}`, { tenant: S.admin.tenantId });
  check('P6.14 DB truth: lead status still "new" after the blocked bulk',
    String(leadStatusUntouched[0]?.lead_status) === 'new', JSON.stringify(leadStatusUntouched[0]));

  const contactsList = await call(rep, '/api/tenant/contacts?limit=100', { method: 'GET' });
  const contactRow = dataArr(contactsList).find((c) => c.id === S.contactId) ?? {};
  check('P6.15 GET /api/tenant/contacts as rep: job_title stripped (title alias too)',
    contactsList.status === 200 && absentFrom(contactRow, ['job_title', 'jobTitle', 'title']),
    `HTTP ${contactsList.status} · keys=${Object.keys(contactRow).slice(0, 14).join(',')}`);

  const cExp = await call(rep, '/api/tenant/contacts/export', { method: 'GET' });
  const cHeader = (cExp.text.split('\n')[0] ?? '').trim();
  check('P6.16 GET /api/tenant/contacts/export CSV: first_name kept, job_title column projected out',
    cExp.status === 200 && /first_name/.test(cHeader) && !/job_title/.test(cHeader),
    `HTTP ${cExp.status} · header="${cHeader.slice(0, 120)}"`);
}

// ── P7 · #2627: PATCH without amount preserves the stored amount ───────────
async function phase7(): Promise<void> {
  phase('P7 · #2627 — deal PATCH preserves amount when not sent');
  if (!S.dealId) { check('P7.1 PATCH preserves amount', false, 'no seeded deal (P6 aborted)'); return; }
  const res = await call(S.admin.client!, `/api/tenant/deals/${S.dealId}`, {
    method: 'PATCH', body: { title: `Admin Rename ${NONCE}` }, withCsrf: true,
  });
  const bodyAmount = firstKeys(dataObj(res), ['amount', 'value']);
  const dbRow = await q(sql`SELECT amount, title FROM deals WHERE id = ${S.dealId}`, { tenant: S.admin.tenantId });
  check('P7.1 PATCH /api/tenant/deals/[id] {title only} -> amount 5000 survives (response + DB)',
    res.status === 200 && Number(bodyAmount) === 5000 && Number(dbRow[0]?.amount) === 5000,
    `HTTP ${res.status} · resp.amount=${bodyAmount} db=${JSON.stringify(dbRow[0])}`);
}

// ── P8 · #2630: auth rate buckets — fail-closed + per-email/per-IP split ───
async function phase8(): Promise<void> {
  phase('P8 · #2630 — login buckets: fail-closed without IP; email vs IP buckets separate');

  const noIp = new Client('');
  const gated = await call(noIp, '/api/auth/login', {
    body: { email: mkEmail('nobody'), password: 'whatever' },
    suppressXff: true,
    headers: { 'x-forwarded-for': '' },
  });
  check('P8.1 login with no client IP + TRUST_PROXY=true -> 503 fail-closed (no shared "unknown" bucket)',
    gated.status === 503 && /rate limiter misconfigured/i.test(gated.text),
    `HTTP ${gated.status} · ${gated.text.slice(0, 140)}`);

  // Burn email bucket for repA from a dedicated IP.
  const attackIp = mkIp();
  let lastBad = 0;
  for (let i = 0; i < 6; i++) {
    const c = new Client(attackIp);
    const bad = await call(c, '/api/auth/login', {
      body: { email: S.repA.email, password: `Wrong!${NONCE}${i}` },
    });
    lastBad = bad.status;
  }
  note(`repA wrong-password sweep from ${attackIp}: last HTTP ${lastBad}`);

  const blocks = await q(sql`SELECT identifier, identifier_type FROM login_blocks WHERE identifier IN (${S.repA.email}, ${attackIp})`);
  note(`login_blocks rows: ${blocks.map((b) => `${b.identifier_type}:${b.identifier}`).join(', ') || '(none)'}`);

  const aCleanIp = new Client(mkIp());
  const aOk = await call(aCleanIp, '/api/auth/login', {
    body: { email: S.repA.email, password: REP_PASSWORD },
  });
  check('P8.2 repA correct login from a CLEAN ip -> 429 (email-scoped block, not just the attack IP)',
    aOk.status === 429, `HTTP ${aOk.status} · ${aOk.text.slice(0, 120)}`);

  const bCleanIp = new Client(mkIp());
  const bOk = await call(bCleanIp, '/api/auth/login', {
    body: { email: S.repB.email, password: REP_PASSWORD },
  });
  check('P8.3 repB correct login -> 200 (dual buckets: repA failures cannot poison repB)',
    bOk.status === 200 && !!bCleanIp.session, `HTTP ${bOk.status}`);
}

// ── Runner ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`NuCRM base-CRM acceptance — nonce ${NONCE} against ${BASE_URL}`);
  const phases = [phase0, phase1, phase2, phase3, phase4, phase5, phase6, phase7, phase8];
  for (const p of phases) {
    try {
      await p();
    } catch (err) {
      fail(`${p.name} crashed`, err);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`ACCEPTANCE LEDGER — ${passed}/${results.length} PASS, ${failed.length} FAIL (nonce ${NONCE})`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  if (skipped.length) for (const s of skipped) console.log(`  SKIP  ${s}`);
  console.log(`${'═'.repeat(72)}`);
  if (failed.length) {
    console.log('FAILED CHECKS:');
    for (const r of failed) console.log(`  - ${r.name}\n      ${r.detail}`);
  }
  console.log(`\nEvidence handles: tenant=${S.admin.tenantId} deal=${S.dealId} lead=${S.leadId} contact=${S.contactId} template=${S.customTemplate.id} repRole=${S.repRoleId}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});

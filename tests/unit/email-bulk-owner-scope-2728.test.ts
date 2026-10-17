/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2728 — `email/bulk` scoped its recipient set to the workspace, not to the caller.
 *
 * The route asks `contacts.edit` and then resolves `entity_ids` on
 * `tenant_id + deleted_at IS NULL + do_not_contact = false`. `entity_ids` is a
 * set the client assembled, so a `sales_rep` whose `contacts.view_all` is
 * explicitly false (`lib/permissions/definitions.ts:133`) — and whom
 * `contacts/[id]:82-87` answers 404 for a row that is neither `assigned_to` nor
 * `created_by` them — queued a templated mail to any contact in the workspace.
 *
 * The reader answers the rendered predicate the way Postgres would: the ids the
 * `in (...)` binds, the tenant, the tombstone, the do-not-contact flag, and
 * whether the query narrows to the caller. Red against `main`, not red because a
 * call was missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const TEMPLATE_ELSEWHERE = '66666666-6666-4666-8666-666666666666';
const CONTACT_MINE = '77777777-7777-4777-8777-777777777777';
const CONTACT_OTHER = '88888888-8888-4888-8888-888888888888';
const CONTACT_MINE_UNSUBSCRIBED = '99999999-9999-4999-8999-999999999999';
const CONTACT_MINE_TRASHED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_MINE_DNC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_OTHER_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const dialect = new PgDialect({} as never);
const OWNER_CLAUSE = /"contacts"\."assigned_to" = .* OR "contacts"\."created_by" = /i;

type Q = { sql: string; params: unknown[]; table: string };
type Contact = {
  id: string; tenantId: string; assignedTo: string | null; createdBy: string | null;
  email: string | null; firstName: string; lastName: string;
  unsubscribed: boolean; doNotContact: boolean; deletedAt: Date | null;
};

let reads: Q[] = [];
let jobs: Record<string, unknown>[] = [];
let audits: Record<string, unknown>[] = [];
let contacts_: Record<string, Contact> = {};
let templates: Record<string, { id: string; tenantId: string; subject: string; bodyHtml: string }> = {};

function render(predicate: unknown, table: string): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table };
}

function boundValue(query: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`).exec(query.sql);
  return m ? query.params[Number(m[1]) - 1] : undefined;
}

/** The values an `in (...)` term binds — the whole `entity_ids` set. */
function boundList(query: Q, column: string): unknown[] | undefined {
  const m = new RegExp(`"${column}" in \\(([^)]*)\\)`, 'i').exec(query.sql);
  if (!m) return undefined;
  return m[1].split(',').map((term) => {
    const d = /\$(\d+)/.exec(term);
    return d ? query.params[Number(d[1]) - 1] : undefined;
  });
}

const narrowed = (query: Q) => OWNER_CLAUSE.test(query.sql) && query.params.includes(MINE);
const owned = (row: Contact) => row.assignedTo === MINE || row.createdBy === MINE;

function answer(query: Q): unknown[] {
  if (query.table === 'email_templates') {
    const id = boundValue(query, 'id');
    const template = typeof id === 'string' ? templates[id] : undefined;
    return template && template.tenantId === boundValue(query, 'tenant_id') ? [template] : [];
  }
  if (query.table !== 'contacts') return [];
  const ids = boundList(query, 'id');
  if (!ids) return [];
  return Object.values(contacts_).filter((row) =>
    ids.includes(row.id)
    && row.tenantId === boundValue(query, 'tenant_id')
    && (query.sql.match(/"deleted_at" is null/i) ? row.deletedAt === null : true)
    && (boundValue(query, 'do_not_contact') === undefined
      ? true
      : row.doNotContact === boundValue(query, 'do_not_contact'))
    && (!narrowed(query) || owned(row)));
}

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let table: string | undefined;
  let where: Q | undefined;
  builder['from'] = (t: object) => { table = getTableName(t as never); return builder; };
  for (const m of ['leftJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    where = render(predicate, table as string);
    reads.push(where);
    return builder;
  };
  const resolve = () => (where ? answer(where) : []);
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeSelectBuilder()),
  insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined), tenantMeta: () => ({}) }));
vi.mock('@/lib/queue', () => ({ addJob: (_name: string, payload: Record<string, unknown>) => { jobs.push(payload); return Promise.resolve(); } }));
vi.mock('@/lib/audit', () => ({
  logAudit: (entry: Record<string, unknown>) => { audits.push(entry); return Promise.resolve(); },
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const emailBulk = await import('@/app/api/tenant/email/bulk/route');

let body: Record<string, unknown> = {};

const REP = { 'contacts.edit': true, 'contacts.create': true, 'contacts.view_all': false };
const SEES_ALL = { 'contacts.edit': true, 'contacts.view_all': true };
const EDIT_ONLY = { 'contacts.edit': true };
const NO_RIGHTS: Record<string, boolean> = {};

type Perms = Record<string, boolean>;

async function send(perms: Perms, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions: perms,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
  body = payload;
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/email/bulk'), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (emailBulk.POST as (req: NextRequest) => Promise<Response>)(req);
}

const contact = (id: string, assignedTo: string | null, createdBy: string | null, over: Partial<Contact> = {}): Contact => ({
  id, tenantId: TENANT, assignedTo, createdBy,
  email: `${id.slice(0, 4)}@corp.example`, firstName: 'First', lastName: 'Last',
  unsubscribed: false, doNotContact: false, deletedAt: null, ...over,
});

/** The contact ids the queue payload actually carries. */
function queuedIds() {
  return (jobs[0]?.recipients as { contact_id: string }[]).map((r) => r.contact_id).sort();
}

beforeEach(() => {
  reads = [];
  jobs = [];
  audits = [];
  body = {};
  templates = {
    [TEMPLATE]: { id: TEMPLATE, tenantId: TENANT, subject: 'Hi', bodyHtml: 'Hello {first_name}' },
    [TEMPLATE_ELSEWHERE]: { id: TEMPLATE_ELSEWHERE, tenantId: ELSEWHERE, subject: 'Hi', bodyHtml: 'Hello' },
  };
  contacts_ = {
    [CONTACT_MINE]: contact(CONTACT_MINE, MINE, MINE),
    [CONTACT_OTHER]: contact(CONTACT_OTHER, OTHER, OTHER),
    [CONTACT_MINE_UNSUBSCRIBED]: contact(CONTACT_MINE_UNSUBSCRIBED, MINE, OTHER, { unsubscribed: true }),
    [CONTACT_MINE_TRASHED]: contact(CONTACT_MINE_TRASHED, MINE, MINE, { deletedAt: new Date('2026-10-01') }),
    [CONTACT_MINE_DNC]: contact(CONTACT_MINE_DNC, MINE, MINE, { doNotContact: true }),
    [CONTACT_OTHER_TENANT]: contact(CONTACT_OTHER_TENANT, MINE, MINE, { tenantId: ELSEWHERE }),
  };
});

describe('a bulk send reaches only the contacts the caller may touch (#2728)', () => {
  it('a foreign contact is not mailed, and the batch reports nothing to send', async () => {
    const res = await send(REP, { entity_type: 'contact', entity_ids: [CONTACT_OTHER], template_id: TEMPLATE });
    expect(res.status).toBe(400);
    expect(jobs).toHaveLength(0);
  });

  it('the recipient read asks the contact rule next to the compliance terms it already asked', async () => {
    await send(REP, { entity_type: 'contact', entity_ids: [CONTACT_MINE, CONTACT_OTHER], template_id: TEMPLATE });
    const read = reads.find((q) => q.table === 'contacts')!;
    expect(read.sql).toMatch(OWNER_CLAUSE);
    expect(read.params).toContain(TENANT);
    expect(read.sql).toMatch(/"deleted_at" is null/i);
    expect(read.sql).toMatch(/"do_not_contact"/);
    expect(read.sql).toMatch(/"contacts"\."id" in \(/i);
  });

  it('a mixed set queues the caller\'s own rows and drops the rest', async () => {
    const res = await send(REP, {
      entity_type: 'contact',
      entity_ids: [CONTACT_MINE, CONTACT_OTHER, CONTACT_OTHER_TENANT],
      template_id: TEMPLATE,
    });
    expect(res.status, await res.text()).toBe(200);
    expect(queuedIds()).toEqual([CONTACT_MINE]);
  });

  it('the audit and the response count the sendable set, not the requested one', async () => {
    await send(REP, {
      entity_type: 'contact', entity_ids: [CONTACT_MINE, CONTACT_OTHER, CONTACT_OTHER], template_id: TEMPLATE,
    });
    expect(audits[0]).toMatchObject({ tenantId: TENANT, userId: MINE, action: 'bulk_email' });
    expect((audits[0]?.newData as Record<string, unknown>).queued).toBe(1);
  });

  it('a contacts.view_all holder is untouched: no owner term, and the whole set queued', async () => {
    const res = await send(SEES_ALL, {
      entity_type: 'contact', entity_ids: [CONTACT_MINE, CONTACT_OTHER], template_id: TEMPLATE,
    });
    expect(res.status, await res.text()).toBe(200);
    const read = reads.find((q) => q.table === 'contacts')!;
    expect(read.sql).not.toMatch(OWNER_CLAUSE);
    expect(read.params).not.toContain(MINE);
    expect(queuedIds()).toEqual([CONTACT_MINE, CONTACT_OTHER].sort());
  });

  it('select-all-matching ids from another tenant never resolve', async () => {
    const res = await send(SEES_ALL, { entity_type: 'contact', entity_ids: [CONTACT_OTHER_TENANT], template_id: TEMPLATE });
    expect(res.status).toBe(400);
    expect(jobs).toHaveLength(0);
  });
});

describe('the terms this route already got right still stand (#2728)', () => {
  it('an unsubscribed contact is skipped and counted, as #1120 reports it', async () => {
    const res = await send(SEES_ALL, {
      entity_type: 'contact', entity_ids: [CONTACT_MINE, CONTACT_MINE_UNSUBSCRIBED], template_id: TEMPLATE,
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    expect(json).toMatchObject({ count: 1, skipped_unsubscribed: 1 });
    expect(queuedIds()).toEqual([CONTACT_MINE]);
  });

  it('a trashed contact is not mailed', async () => {
    const res = await send(SEES_ALL, { entity_type: 'contact', entity_ids: [CONTACT_MINE_TRASHED], template_id: TEMPLATE });
    expect(res.status).toBe(400);
    expect(jobs).toHaveLength(0);
  });

  it('a do-not-contact row is refused in SQL, not in JS', async () => {
    const res = await send(SEES_ALL, { entity_type: 'contact', entity_ids: [CONTACT_MINE_DNC], template_id: TEMPLATE });
    expect(res.status).toBe(400);
    const read = reads.find((q) => q.table === 'contacts')!;
    expect(boundValue(read, 'do_not_contact')).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  it('a template from another workspace is a 404 before any recipient is read', async () => {
    const res = await send(SEES_ALL, { entity_type: 'contact', entity_ids: [CONTACT_MINE], template_id: TEMPLATE_ELSEWHERE });
    expect(res.status).toBe(404);
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('email_templates');
    expect(jobs).toHaveLength(0);
  });

  it('the empty and oversized batches are refused before anything is read', async () => {
    expect((await send(SEES_ALL, { entity_ids: [], template_id: TEMPLATE })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => i);
    expect((await send(SEES_ALL, { entity_ids: tooMany, template_id: TEMPLATE })).status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('and contacts.edit is still the gate', async () => {
    const res = await send(NO_RIGHTS, { entity_ids: [CONTACT_MINE], template_id: TEMPLATE });
    expect(res.status).toBe(403);
    expect(reads).toHaveLength(0);
  });

  it('a caller with no view_all and no owned rows queues nothing, whatever it names', async () => {
    const res = await send(EDIT_ONLY, {
      entity_type: 'contact', entity_ids: [CONTACT_OTHER, CONTACT_MINE_TRASHED], template_id: TEMPLATE,
    });
    expect(res.status).toBe(400);
    expect(jobs).toHaveLength(0);
  });
});

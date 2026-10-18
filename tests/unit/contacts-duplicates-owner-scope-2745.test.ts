/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2745 — the duplicate finder aggregated the whole workspace, so a rep read
 * other owners' contact details out of the group rows.
 *
 * `app/api/tenant/contacts/duplicates/route.ts` built three groups straight from
 * `db.execute` (`:27-60` before this fix) narrowed by `tenant_id` and the
 * tombstone only. Each group row then carried `match_value` — the shared email,
 * phone or name itself — plus `contact_ids`, and the details for those ids were
 * read with `where(inArray(contacts.id, allIds))` (`:107-117`): neither a tenant
 * term nor an owner term. `enforceFieldRead` (`:121`) restricts *columns* for a
 * role (#2618); it never filters rows.
 *
 * The rest of the app refuses those same rows. `contacts/[id]/route.ts:84-86`
 * 404s a contact the caller neither owns nor created, and `contacts/route.ts:59`
 * hides it from the list, both for any caller lacking `contacts.view_all` —
 * which `sales_rep` does (`lib/permissions/definitions.ts:132-137` holds every
 * contact permission with `view_all: false`). So the duplicate page was the
 * cheapest way for a rep to enumerate the workspace: the emails, the phones, the
 * names, and the `created_at` of records they cannot open.
 *
 * The db double here is a matcher, not a queue. It renders each predicate — the
 * spliced raw one and the drizzle one — through drizzle's own Postgres dialect
 * and answers it against snake-cased rows by *position*, the way Postgres binds
 * `$n`. A canned "here are two groups!" reader would have graded the mock and
 * passed with no owner term at all, which is precisely the bug: the expectations
 * below are red against `main` because the aggregates genuinely return the
 * cross-owner groups there.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const dialect = new PgDialect({} as never);

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEWBIE = 'ee000000-0000-4000-8000-000000000009';

const CA = 'ca000000-0000-4000-8000-000000000001'; // shared email + name, not mine
const CB = 'cb000000-0000-4000-8000-000000000002'; // shared email + name, mine
const CC = 'cc000000-0000-4000-8000-000000000003'; // shared phone, mine
const CD = 'cd000000-0000-4000-8000-000000000004'; // shared phone, mine
const CE = 'ce000000-0000-4000-8000-000000000005'; // foreign-only email pair
const CF = 'cf000000-0000-4000-8000-000000000006'; // foreign-only email pair
const CG = 'cg000000-0000-4000-8000-000000000007'; // tombstoned, shares the email

const SHARED_EMAIL = 'priya@acme.example.test';
const SHARED_PHONE = '+15550003333';
const FOREIGN_EMAIL = 'cfo@globex.example.test';
const SECRET_NOTES_OWNER = 'Renewal at 40k, budget owner is her CFO.';

type Col = string | number | Date | null;
type Row = Record<string, Col>;

function contact(
  id: string,
  email: string,
  phone: string,
  firstName: string,
  lastName: string,
  owner: string,
  extra: Partial<Row> = {},
): Row {
  return {
    id,
    tenant_id: TENANT,
    email,
    phone,
    first_name: firstName,
    last_name: lastName,
    assigned_to: owner,
    created_by: owner,
    deleted_at: null,
    created_at: new Date('2026-01-05T00:00:00.000Z'),
    notes: id === CA ? SECRET_NOTES_OWNER : null,
    ...extra,
  };
}

function workspace(): Row[] {
  return [
    contact(CA, SHARED_EMAIL, '+15550001111', 'Priya', 'Nair', OTHER),
    contact(CB, SHARED_EMAIL, '+15550002222', 'Priya', 'Nair', MINE),
    contact(CC, 'cc@acme.example.test', SHARED_PHONE, 'Asha', 'Rao', MINE),
    contact(CD, 'cd@acme.example.test', SHARED_PHONE, 'Asha', 'Rao', MINE),
    contact(CE, FOREIGN_EMAIL, '+15550005555', 'Ivan', 'Holt', OTHER),
    contact(CF, FOREIGN_EMAIL, '+15550006666', 'Ivan', 'Holt', OTHER),
    contact(CG, SHARED_EMAIL, '+15550007777', 'Priya', 'Nair', MINE, {
      deleted_at: new Date('2026-02-01T00:00:00.000Z'),
    }),
  ];
}

let rows: Row[];
let executed: Array<{ sql: string; params: unknown[] }>;
let selected: Array<{ sql: string; params: unknown[] }>;

/** The `$n` a term is bound to — the way Postgres reads its own parameter list. */
function bound(sqlText: string, params: unknown[], term: RegExp): unknown | undefined {
  const m = sqlText.match(term);
  return m ? params[Number(m[1]) - 1] : undefined;
}

function passesWhere(sqlText: string, params: unknown[], row: Row): boolean {
  const tenant = bound(sqlText, params, /tenant_id"?\s*=\s*\$(\d+)/);
  if (tenant !== undefined && row.tenant_id !== tenant) return false;

  if (/deleted_at"?\s+IS NULL/i.test(sqlText) && row.deleted_at !== null) return false;

  const assigned = bound(sqlText, params, /"assigned_to"\s*=\s*\$(\d+)/);
  const created = bound(sqlText, params, /"created_by"\s*=\s*\$(\d+)/);
  if (assigned !== undefined || created !== undefined) {
    if (row.assigned_to !== assigned && row.created_by !== created) return false;
  }

  const idIn = sqlText.match(/"id"\s+in\s+\(([^)]*)\)/i);
  if (idIn) {
    const ids = [...idIn[1].matchAll(/\$(\d+)/g)].map((m) => params[Number(m[1]) - 1]);
    if (!ids.includes(row.id)) return false;
  }

  return true;
}

/** Answers the three `db.execute` aggregates as Postgres would answer them. */
function aggregate(sqlText: string, params: unknown[]): Row[] {
  const isEmail = /LOWER\(email\)/.test(sqlText);
  const isPhone = /GROUP BY phone/.test(sqlText);
  const alias = isEmail ? 'email' : isPhone ? 'phone' : 'full_name';

  const required = isEmail ? 'email' : isPhone ? 'phone' : 'first_name';
  const candidates = rows.filter((r) => {
    if (sqlText.includes(`${required} IS NOT NULL`) && r[required] === null) return false;
    if (sqlText.includes(`${required} != ''`) && (r[required] === '' || r[required] === null)) return false;
    return passesWhere(sqlText, params, r);
  });

  const groups = new Map<string, Row[]>();
  for (const r of candidates) {
    const key = isEmail
      ? String(r.email).toLowerCase()
      : isPhone
        ? String(r.phone)
        : `${String(r.first_name).toLowerCase()} ${String(r.last_name ?? '').toLowerCase()}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(r);
    groups.set(key, bucket);
  }

  const limit = Number(sqlText.match(/LIMIT (\d+)/)?.[1] ?? 50);
  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, bucket]) => ({
      [alias]: key,
      contact_ids: bucket.map((r) => String(r.id)),
      cnt: bucket.length,
    }));
}

function makeSelectBuilder(fields: Record<string, unknown>) {
  const builder: Record<string, unknown> = {};
  let own: { sql: string; params: unknown[] } | undefined;
  for (const m of ['from', 'leftJoin', 'orderBy', 'groupBy', 'limit']) builder[m] = () => builder;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    own = { sql: rendered.sql, params: rendered.params };
    selected.push(own);
    return builder;
  };
  builder['then'] = (resolve: (v: Row[]) => unknown) => {
    const matched = own ? rows.filter((r) => passesWhere(own.sql, own.params, r)) : [];
    // Project exactly the columns the route asked for — an unprojected row would
    // hand the test a field the real route never returns.
    const projected = matched.map((r) => {
      const out: Row = {};
      for (const [key, col] of Object.entries(fields)) {
        const name = (col as { name?: string })?.name;
        out[key] = name ? r[name] ?? null : null;
      }
      return out;
    });
    return resolve(projected);
  };
  return builder;
}

const mockDb = {
  execute: vi.fn(async (query: unknown) => {
    const rendered = dialect.sqlToQuery(query as never);
    executed.push({ sql: rendered.sql, params: rendered.params });
    return { rows: aggregate(rendered.sql, rendered.params) };
  }),
  select: vi.fn((fields: Record<string, unknown>) => makeSelectBuilder(fields)),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
// #2618: column restrictions only. Mocked as the identity so this file grades the
// row predicate, and so that a passing suite cannot be mistaken for coverage of
// `enforceFieldRead` itself.
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: async (_ctx: unknown, _entity: string, list: unknown[]) => list,
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/contacts/duplicates/route');

const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };

function ctx(permissions: Record<string, boolean>, userId = MINE): AuthContext {
  return {
    userId, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function get(): Promise<Response> {
  return (route.GET as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('http://localhost:3000/api/tenant/contacts/duplicates'), {
      method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
}

async function body(res: Response) {
  return res.json() as Promise<{
    data: {
      groups: Array<{ match_type: string; match_value: string; contact_ids: string[]; count: number; contacts: Row[] }>;
      total_duplicate_groups: number;
      total_duplicate_contacts: number;
    };
  }>;
}

function setup(permissions: Record<string, boolean>, userId = MINE) {
  rows = workspace();
  executed = [];
  selected = [];
  mockDb.execute.mockClear();
  mockDb.select.mockClear();
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx(permissions, userId));
}

describe('the duplicate aggregates are narrowed to the caller\'s contacts (#2745)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('every strategy carries the owner predicate for a rep', async () => {
    setup(REP);
    await get();
    expect(executed).toHaveLength(3);
    for (const q of executed) {
      expect(q.sql).toContain('"contacts"."assigned_to" = $');
      expect(q.sql).toContain('"contacts"."created_by" = $');
      expect(q.params).toContain(MINE);
    }
  });

  it('a view_all holder\'s aggregates are byte-for-byte the old query', async () => {
    setup(MANAGER);
    await get();
    expect(executed).toHaveLength(3);
    for (const q of executed) {
      expect(q.sql).not.toContain('assigned_to');
      expect(q.sql).not.toContain('created_by');
    }
    expect(executed[0].sql).toMatch(/AND email != ''\s+GROUP BY LOWER\(email\)/);
    expect(executed[1].sql).toMatch(/AND phone != ''\s+GROUP BY phone/);
    expect(executed[2].sql).toMatch(/AND first_name IS NOT NULL\s+GROUP BY/);
  });

  it('a rep is not handed a contact they do not own', async () => {
    setup(REP);
    const res = await get();
    const text = await res.text();
    expect(text).not.toContain(CA);
    expect(text).not.toContain(CE);
    expect(text).not.toContain(CF);
    expect(text).not.toContain(SECRET_NOTES_OWNER);
  });

  it('the response stops echoing another owner\'s email, phone or name', async () => {
    setup(REP);
    const json = await body(await get());
    const values = json.data.groups.map((g) => g.match_value);
    expect(values).not.toContain(SHARED_EMAIL);
    expect(values).not.toContain(FOREIGN_EMAIL);
    expect(values).not.toContain('priya nair');
  });

  it('counts describe the caller\'s duplicates, not the workspace', async () => {
    setup(REP);
    const json = await body(await get());
    expect(json.data.total_duplicate_groups).toBe(1);
    expect(json.data.total_duplicate_contacts).toBe(2);
  });

  it('a pair the caller does own still comes back', async () => {
    setup(REP);
    const json = await body(await get());
    expect(json.data.groups).toHaveLength(1);
    const group = json.data.groups[0];
    expect(group.match_type).toBe('phone');
    expect(group.match_value).toBe(SHARED_PHONE);
    expect([...group.contact_ids].sort()).toEqual([CC, CD].sort());
    expect(group.contacts).toHaveLength(2);
  });

  it('a group split across owners disappears instead of rendering half of it', async () => {
    setup(REP);
    const json = await body(await get());
    for (const group of json.data.groups) {
      expect(group.contact_ids.length).toBeGreaterThan(1);
      expect(group.contact_ids).not.toContain(CA);
    }
  });

  it('a caller who owns no duplicates gets an empty list, not an error', async () => {
    setup(REP, NEWBIE);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.data.groups).toEqual([]);
    expect(json.data.total_duplicate_contacts).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('a view_all holder still sees the cross-owner pair', async () => {
    setup(MANAGER);
    const json = await body(await get());
    const emailGroup = json.data.groups.find((g) => g.match_value === SHARED_EMAIL);
    expect(emailGroup).toBeDefined();
    expect([...emailGroup!.contact_ids].sort()).toEqual([CA, CB].sort());
    expect(json.data.total_duplicate_groups).toBe(3);
  });

  it('tombstoned contacts stay out of the groups for both roles', async () => {
    setup(MANAGER);
    const json = await body(await get());
    for (const group of json.data.groups) expect(group.contact_ids).not.toContain(CG);

    setup(REP);
    const repJson = await body(await get());
    for (const group of repJson.data.groups) expect(group.contact_ids).not.toContain(CG);
  });

  it('the detail read carries a tenant term it never had', async () => {
    setup(MANAGER);
    await get();
    expect(selected).toHaveLength(1);
    expect(selected[0].sql).toContain('"contacts"."tenant_id" = $1');
    expect(selected[0].params[0]).toBe(TENANT);
    expect(selected[0].sql).toMatch(/"contacts"."id" in \(\$2/i);
  });

  it('the detail read is owner-narrowed for a rep and untouched for a manager', async () => {
    setup(REP);
    await get();
    expect(selected).toHaveLength(1);
    expect(selected[0].sql).toContain('"contacts"."assigned_to"');

    setup(MANAGER);
    await get();
    expect(selected[0].sql).not.toContain('assigned_to');
  });
});

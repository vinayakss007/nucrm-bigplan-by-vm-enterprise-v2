/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2719 — `GET /api/tenant/calls` is the only call-log read that never asks
 * whether the row, or the contact it hangs off, was deleted.
 *
 * `DELETE /api/tenant/calls/:id` is a soft delete, and the list's `filters`
 * array (`app/api/tenant/calls/route.ts:103-105`) is only ever `tenant_id`,
 * `contact_id`, `deal_id` and the owner term. So:
 *
 * | | tombstone filter |
 * | --- | --- |
 * | `POST` (same file, `:50-58`) | `isNull(contacts.deletedAt)` — you cannot log a call onto a deleted contact |
 * | `PATCH` / `DELETE` (`[id]/route.ts`) | `isNull(callLogs.deletedAt)` |
 * | `GET` the list | none, on either |
 *
 * A deleted call therefore keeps listing with its `notes`, `phoneNumber` and
 * `recordedUrl` intact, and — because the `leftJoin` at `:141` carries no
 * condition on the partner either — a soft-deleted contact keeps feeding
 * `firstName / lastName / email` into every call log that references them. The
 * POST in the same file is the proof the rule was intended.
 *
 * The double models the LEFT JOIN: rows are assembled from the call and its
 * contact, then filtered by whether each row's own values satisfy the rendered
 * predicate. That distinction is the whole test — `contacts.deleted_at IS NULL`
 * must keep dropping a call whose contact is deleted while still admitting a
 * call with NO contact, because the absent join partner yields `NULL` and
 * `NULL IS NULL` is true. A canned row queue could not express that.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIVE_CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAD_CONTACT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DELETED_CALL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TOMB = new Date('2026-02-01T00:00:00.000Z');

const dialect = new PgDialect({} as never);

interface Call { id: string; contactId: string | null; dealId: string | null; userId: string; deletedAt: Date | null; notes: string }
interface Contact { id: string; firstName: string; lastName: string; email: string; deletedAt: Date | null }

const DEAD_EMAIL = 'gone@example.test';
const DEAD_NOTES = 'Cancellation call — card on file.';

let calls: Call[] = [];
const contacts: Record<string, Contact> = {
  [LIVE_CONTACT]: { id: LIVE_CONTACT, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', deletedAt: null },
  [DEAD_CONTACT]: { id: DEAD_CONTACT, firstName: 'Grace', lastName: 'Hopper', email: DEAD_EMAIL, deletedAt: TOMB },
};
let whereClauses: { sql: string; params: unknown[] }[] = [];

function joined(call: Call) {
  const contact = call.contactId ? contacts[call.contactId] : undefined;
  return {
    id: call.id, tenantId: TENANT, contactId: call.contactId, dealId: call.dealId,
    userId: call.userId, notes: call.notes, phoneNumber: '+1555000' + call.id.slice(0, 4),
    recordedUrl: 'https://recordings.example.test/c/' + call.id, duration: 12,
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    firstName: contact?.firstName ?? null, lastName: contact?.lastName ?? null,
    email: contact?.email ?? null,
  };
}

/** Would Postgres return this row for this WHERE clause? */
function matches(p: { sql: string; params: unknown[] }, call: Call): boolean {
  const term = (t: string, c: string) => new RegExp(`"${t}"\\."${c}"`, 'i').test(p.sql);
  const tomb = (t: string) => new RegExp(`"${t}"\\."deleted_at" IS NULL`, 'i').test(p.sql);
  if (term('call_logs', 'tenant_id') && !p.params.includes(TENANT)) return false;
  if (term('call_logs', 'user_id') && !p.params.includes(call.userId)) return false;
  if (term('call_logs', 'contact_id') && !(call.contactId && p.params.includes(call.contactId))) return false;
  if (term('call_logs', 'deal_id') && !(call.dealId && p.params.includes(call.dealId))) return false;
  if (tomb('call_logs') && call.deletedAt !== null) return false;
  if (tomb('contacts')) {
    const contact = call.contactId ? contacts[call.contactId] : undefined;
    // An absent join partner yields NULL for every contacts column, and
    // `NULL IS NULL` is true — a call with no contact stays in the list.
    if (contact && contact.deletedAt !== null) return false;
  }
  return true;
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'offset']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    whereClauses.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) =>
    resolve(calls.filter(c => matches(whereClauses[whereClauses.length - 1], c)).map(joined));
  return builder;
}

const mockDb: Record<string, unknown> = { select: vi.fn(() => makeBuilder()) };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const list = await import('@/app/api/tenant/calls/route');

const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };

function setup(permissions: Record<string, boolean>) {
  whereClauses = [];
  calls = [
    { id: 'call-live-mine', contactId: LIVE_CONTACT, dealId: null, userId: MINE, deletedAt: null, notes: 'Scoped the renewal.' },
    { id: 'call-live-other', contactId: LIVE_CONTACT, dealId: null, userId: OTHER, deletedAt: null, notes: 'Other rep, same contact.' },
    // The two rows this issue is about:
    { id: DELETED_CALL, contactId: LIVE_CONTACT, dealId: null, userId: MINE, deletedAt: TOMB, notes: DEAD_NOTES },
    { id: 'call-on-dead-contact', contactId: DEAD_CONTACT, dealId: null, userId: MINE, deletedAt: null, notes: 'They asked to be removed.' },
    // Control: no join partner at all (contactId is nullable, onDelete set null).
    { id: 'call-orphan', contactId: null, dealId: null, userId: MINE, deletedAt: null, notes: 'Anonymous inbound.' },
  ];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
}

async function get(path = '/api/tenant/calls') {
  return (list.GET as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL(path, 'http://localhost:3000'), {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
}

async function ids(permissions: Record<string, boolean>, path?: string) {
  setup(permissions);
  const res = await get(path);
  expect(res.status, await res.clone().text()).toBe(200);
  const json = JSON.parse(await res.text());
  return (json.data as { id: string }[]).map(r => r.id);
}

describe('the list stops returning tombstoned call logs (#2719)', () => {
  it('a soft-deleted call is not returned', async () => {
    expect(await ids(REP)).not.toContain(DELETED_CALL);
  });

  it('its notes and recording are not in the body either', async () => {
    setup(REP);
    const res = await get();
    const text = await res.text();
    expect(text).not.toContain(DEAD_NOTES);
    expect(text).not.toContain('https://recordings.example.test/c/' + DELETED_CALL);
  });

  it('the WHERE names the call_logs tombstone', async () => {
    setup(REP);
    await get();
    expect(whereClauses.length).toBeGreaterThan(0);
    for (const w of whereClauses) {
      expect(w.sql, w.sql).toMatch(/"call_logs"\."deleted_at" IS NULL/i);
    }
  });
});

describe('a deleted contact no longer rides along (#2719)', () => {
  it('the call attached to a soft-deleted contact is dropped', async () => {
    expect(await ids(REP)).not.toContain('call-on-dead-contact');
  });

  it('and its email address is not echoed for any row', async () => {
    setup(REP);
    const res = await get();
    expect(await res.text()).not.toContain(DEAD_EMAIL);
  });

  it('the WHERE conditions the contacts join partner', async () => {
    setup(REP);
    await get();
    expect(whereClauses.some(w => /"contacts"\."deleted_at" IS NULL/i.test(w.sql))).toBe(true);
  });
});

describe('what the filters must not cost (#2719)', () => {
  it('a call with no contact at all still lists — NULL IS NULL is true', async () => {
    expect(await ids(REP)).toContain('call-orphan');
  });

  it('the live rows a caller may see are untouched', async () => {
    expect(await ids(REP)).toEqual(['call-live-mine', 'call-orphan']);
  });

  it('a contacts.view_all holder sees every live row in the tenant', async () => {
    expect(await ids(MANAGER)).toEqual(['call-live-mine', 'call-live-other', 'call-orphan']);
  });

  it('the owner narrowing survives — a rep is still bound to their own logs', async () => {
    setup(REP);
    await get();
    const narrowed = whereClauses.filter(w => /"call_logs"\."user_id"/i.test(w.sql));
    expect(narrowed.length, JSON.stringify(whereClauses)).toBeGreaterThan(0);
    expect(narrowed[0].params).toContain(MINE);
  });

  it('a view_all holder still gets no owner term minted', async () => {
    setup(MANAGER);
    await get();
    for (const w of whereClauses) {
      expect(w.sql, w.sql).not.toMatch(/"call_logs"\."user_id"/i);
    }
  });

  it('the contact_id filter still resolves live rows and nothing else', async () => {
    expect(await ids(REP, '/api/tenant/calls?contact_id=' + LIVE_CONTACT))
      .toEqual(['call-live-mine']);
  });
});

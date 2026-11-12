/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3406 — the verified tombstone leaks, one predicate at a time.
 *
 * The audit named six surfaces where a soft-deleted parent or child was still
 * readable by id: the contact note trail, the contact timeline, the contact
 * lifecycle trail, the contact status PATCH, a deal's line items after DELETE,
 * and an invoice PDF that still rendered removed line items and a tombstoned
 * contact name. Each route already had a deleted-at predicate on *some* query —
 * usually the DELETE that wrote the tombstone — which is exactly why a grep for
 * `isNull` called them fixed while the reads kept returning the row.
 *
 * These assertions are behavioural rather than source scans: the fake renders
 * the WHERE clause each handler actually emits with PgDialect and answers like
 * Postgres would, filtering a seeded row when the statement asks for
 * `deleted_at IS NULL` (or `IS NOT NULL`) on the table that owns it. A route
 * that loses the predicate returns the tombstone and fails here, not in
 * production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DELETED_CONTACT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INVOICE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const dialect = new PgDialect({} as never);

type Row = Record<string, unknown> & { id: string; tenantId: string; deletedAt: Date | null };

const tables: Record<string, Row[]> = {};
const reads: { table: string; sql: string; params: unknown[] }[] = [];
const writes: { table: string; sql: string; params: unknown[] }[] = [];
let body: Record<string, unknown> = {};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function tableOf(table: unknown): string {
  return getTableName(table as never);
}

/** Postgres' answer for the seeded rows, from the predicates the route emitted. */
function rowsFor(table: string, sql: string | null, params: unknown[]): Row[] {
  let rows = [...(tables[table] ?? [])];
  if (!sql) return rows;
  const tombstone = new RegExp(`"${table}"\\."deleted_at" is null`, 'i');
  const tombstoneOnly = new RegExp(`"${table}"\\."deleted_at" is not null`, 'i');
  if (tombstone.test(sql)) rows = rows.filter((r) => r.deletedAt === null);
  if (tombstoneOnly.test(sql)) rows = rows.filter((r) => r.deletedAt !== null);

  // The routes name a row by id; a param that matches a seeded id narrows the
  // answer the way the primary key would. Join keys (contact_id, deal_id,
  // invoice_id) are deliberately left alone — the seeded table only has the
  // rows for the record under test.
  const ids = params.filter((p): p is string => typeof p === 'string');
  const byId = rows.filter((r) => ids.includes(r.id));
  if (byId.length) rows = byId;
  return rows;
}

function makeSelect(cols?: Record<string, unknown>) {
  let table = '';
  let sql: string | null = null;
  let params: unknown[] = [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ['leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'offset', 'limit']) {
    builder[method] = chain;
  }
  builder.from = (t: unknown) => {
    table = tableOf(t);
    return builder;
  };
  builder.where = (predicate: unknown) => {
    const q = render(predicate);
    sql = q.sql;
    params = q.params;
    reads.push({ table, sql: q.sql, params: q.params });
    return builder;
  };
  builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
    const rows = rowsFor(table, sql, params);
    // `count()`/`total` selects are answered with one aggregate row, the shape
    // the timeline route reads.
    const aggregate = cols && Object.keys(cols).some((k) => k === 'total' || k === 'count');
    if (aggregate) return Promise.resolve([{ total: rows.length, count: rows.length }]).then(ok, err);
    // Drizzle projects a selected column under its alias (`contacts.first_name`
    // arrives as `{ name }`); render the same shape so route reads by key work.
    const projected = cols
      ? rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const [key, col] of Object.entries(cols)) {
            const columnName = (col as { name?: string } | null)?.name;
            const camel = columnName?.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
            out[key] = columnName && columnName in row
              ? row[columnName]
              : camel && camel in row
                ? row[camel]
                : row[key];
          }
          return out;
        })
      : rows;
    return Promise.resolve(projected).then(ok, err);
  };
  return builder;
}

function makeUpdate(table: unknown) {
  const name = tableOf(table);
  let sql: string | null = null;
  let params: unknown[] = [];
  let values: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  builder.set = (v: Record<string, unknown>) => {
    values = v;
    return builder;
  };
  builder.where = (predicate: unknown) => {
    const q = render(predicate);
    sql = q.sql;
    params = q.params;
    writes.push({ table: name, sql: q.sql, params: q.params });
    return builder;
  };
  const applied = () => rowsFor(name, sql, params).map((r) => ({ ...r, ...values }));
  builder.returning = () => Promise.resolve(applied());
  builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(applied()).then(ok, err);
  return builder;
}

const tx = {
  update: (table: unknown) => makeUpdate(table),
  insert: () => ({ values: (row: Record<string, unknown>) => Promise.resolve([row]) }),
};

const mockDb = {
  select: (cols?: Record<string, unknown>) => makeSelect(cols),
  update: (table: unknown) => makeUpdate(table),
  insert: () => ({ values: (row: Record<string, unknown>) => Promise.resolve([row]) }),
  transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  query: {
    contacts: {
      findFirst: (options?: { where?: unknown }) => {
        const q = options?.where === undefined ? null : render(options.where);
        if (q) reads.push({ table: 'contacts', sql: q.sql, params: q.params });
        return Promise.resolve(rowsFor('contacts', q?.sql ?? null, q?.params ?? [])[0]);
      },
    },
  },
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => body),
  validateBody: vi.fn(() => ({ success: true, data: body })),
}));
vi.mock('@/lib/notifications', () => ({ processMentions: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/pdf/render', () => ({ renderInvoicePdf: vi.fn(async () => Buffer.from('pdf')) }));
vi.mock('@/lib/pdf/mappers', () => ({
  mapInvoiceToPdfData: (...args: unknown[]) => args,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const notes = await import('@/app/api/tenant/contacts/[id]/notes/route');
const timeline = await import('@/app/api/tenant/contacts/[id]/timeline/route');
const lifecycle = await import('@/app/api/tenant/contacts/[id]/lifecycle/route');
const status = await import('@/app/api/tenant/contacts/[id]/status/route');
const products = await import('@/app/api/tenant/deals/[id]/products/route');
const invoicePdf = await import('@/app/api/tenant/invoices/[id]/pdf/route');

const AUTH = {
  userId: USER,
  tenantId: TENANT,
  roleSlug: 'manager',
  permissions: { 'contacts.view_all': true, 'deals.view_all': true, 'invoices.view': true },
  isAdmin: false,
  isSuperAdmin: false,
} as unknown as AuthContext;

function req(url: string, method = 'GET', payload?: Record<string, unknown>) {
  body = payload ?? {};
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const liveContact = (id = CONTACT): Row => ({
  id, tenantId: TENANT, deletedAt: null, firstName: 'Ada', lastName: 'Lovelace',
  email: 'ada@example.com', assignedTo: USER, createdBy: USER,
  leadStatus: 'new', lifecycleStage: 'lead', updatedAt: new Date('2026-01-01'),
});
const deletedContact = (): Row => ({ ...liveContact(DELETED_CONTACT), deletedAt: new Date() });

const liveItem = (id: string): Row => ({
  id, tenantId: TENANT, dealId: DEAL, deletedAt: null,
  productName: 'Widget', description: 'Widget', quantity: 1, price: '10.00',
  unitPrice: '10.00', total: '10.00', sortOrder: 0,
});
const deletedItem = (id: string): Row => ({ ...liveItem(id), deletedAt: new Date(), description: 'Removed widget' });

const liveDeal: Row = {
  id: DEAL, tenantId: TENANT, deletedAt: null, title: 'Deal',
  assignedTo: USER, createdBy: USER,
};

const liveInvoice: Row = {
  id: INVOICE, tenantId: TENANT, deletedAt: null, invoiceNumber: 'INV-1',
  title: 'January', status: 'sent', issueDate: '2026-01-01', dueDate: null,
  subtotal: '10.00', discountAmount: '0', taxAmount: '0', totalAmount: '10.00',
  amountPaid: '0', balanceDue: '10.00', notes: null, terms: null, footer: null,
  contactId: CONTACT,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
  reads.length = 0;
  writes.length = 0;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.contacts = [liveContact()];
  tables.activities = [
    { id: 'note-live', tenantId: TENANT, contactId: CONTACT, deletedAt: null, eventType: 'note', description: 'Live note', createdAt: new Date('2026-01-02') },
    { id: 'note-deleted', tenantId: TENANT, contactId: CONTACT, deletedAt: new Date(), eventType: 'note', description: 'Deleted note', createdAt: new Date('2026-01-01') },
  ];
  tables.contact_lifecycle_history = [
    { id: 'history-1', tenantId: TENANT, contactId: CONTACT, deletedAt: null, fromStage: 'lead', toStage: 'customer', changedAt: new Date('2026-01-02') },
  ];
  tables.deals = [liveDeal];
  tables.deal_products = [liveItem('item-live'), deletedItem('item-deleted')];
  tables.invoices = [liveInvoice];
  tables.invoice_line_items = [liveItem('line-live'), deletedItem('line-deleted')];
  tables.tenants = [{ id: TENANT, tenantId: TENANT, deletedAt: null, name: 'Acme' }];
  tables.users = [{ id: USER, tenantId: TENANT, deletedAt: null, fullName: 'Ada', email: 'ada@example.com', avatarUrl: null }];
  body = {};
});

function statementsFor(table: string): string[] {
  return reads.filter((r) => r.table === table).map((r) => r.sql);
}

describe('a tombstoned contact is not a parent (#3406)', () => {
  it('notes GET probes the contact with deleted_at IS NULL', async () => {
    const res = await (notes.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/notes`), params(CONTACT),
    );
    expect(res.status, await res.text()).toBe(200);
    const probe = statementsFor('contacts').find((s) => /"contacts"\."id"/.test(s));
    expect(probe, reads.map((r) => `${r.table}: ${r.sql}`).join('\n')).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('notes GET 404s for a tombstoned contact', async () => {
    tables.contacts = [deletedContact()];
    const res = await (notes.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${DELETED_CONTACT}/notes`), params(DELETED_CONTACT),
    );
    expect(res.status).toBe(404);
  });

  it('timeline GET probes the contact with deleted_at IS NULL', async () => {
    const res = await (timeline.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/timeline`), params(CONTACT),
    );
    expect(res.status, await res.text()).toBe(200);
    const probe = statementsFor('contacts').find((s) => /"contacts"\."id"/.test(s));
    expect(probe).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('timeline GET 404s for a tombstoned contact', async () => {
    tables.contacts = [deletedContact()];
    const res = await (timeline.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${DELETED_CONTACT}/timeline`), params(DELETED_CONTACT),
    );
    expect(res.status).toBe(404);
  });

  it('lifecycle GET probes the contact before reading its history', async () => {
    const res = await (lifecycle.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/lifecycle`), params(CONTACT),
    );
    expect(res.status, await res.text()).toBe(200);
    const probe = statementsFor('contacts').find((s) => /"contacts"\."id"/.test(s));
    expect(probe).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('lifecycle GET 404s for a tombstoned contact', async () => {
    tables.contacts = [deletedContact()];
    const res = await (lifecycle.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${DELETED_CONTACT}/lifecycle`), params(DELETED_CONTACT),
    );
    expect(res.status).toBe(404);
    expect(statementsFor('contact_lifecycle_history')).toHaveLength(0);
  });

  it('status PATCH 404s and writes nothing for a tombstoned contact', async () => {
    tables.contacts = [deletedContact()];
    const res = await (status.PATCH as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${DELETED_CONTACT}/status`, 'PATCH', { lead_status: 'contacted' }),
      params(DELETED_CONTACT),
    );
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it('status PATCH keeps deleted_at IS NULL on the write it does make', async () => {
    const res = await (status.PATCH as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/status`, 'PATCH', { lead_status: 'contacted' }),
      params(CONTACT),
    );
    expect(res.status, await res.text()).toBe(200);
    const write = writes.find((w) => w.table === 'contacts');
    expect(write?.sql, writes.map((w) => `${w.table}: ${w.sql}`).join('\n')).toMatch(/"contacts"\."deleted_at" is null/i);
  });
});

describe('a removed line item is not part of the record (#3406)', () => {
  it('deal products GET excludes the line item DELETE tombstoned', async () => {
    const res = await (products.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/deals/${DEAL}/products`), params(DEAL),
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { id: string }[] };
    expect(json.data.map((i) => i.id)).toEqual(['item-live']);
    const list = statementsFor('deal_products').find((s) => /"deal_products"\."deal_id"/.test(s));
    expect(list).toMatch(/"deal_products"\."deleted_at" is null/i);
  });

  it('invoice PDF excludes removed line items and a tombstoned contact name', async () => {
    const res = await (invoicePdf.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/invoices/${INVOICE}/pdf?format=html`), params(INVOICE),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Widget');
    expect(html).not.toContain('Removed widget');
    expect(html).toContain('Ada');
    const lineRead = statementsFor('invoice_line_items').find((s) => /"invoice_line_items"\."invoice_id"/.test(s));
    expect(lineRead).toMatch(/"invoice_line_items"\."deleted_at" is null/i);
    const contactRead = statementsFor('contacts').find((s) => /"contacts"\."id"/.test(s));
    expect(contactRead).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('invoice PDF omits the name when the contact is tombstoned', async () => {
    tables.contacts = [deletedContact()];
    const res = await (invoicePdf.GET as (r: NextRequest, c: unknown) => Promise<Response>)(
      req(`/api/tenant/invoices/${INVOICE}/pdf?format=html`), params(INVOICE),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('N/A');
    expect(html).not.toContain('Ada');
  });
});

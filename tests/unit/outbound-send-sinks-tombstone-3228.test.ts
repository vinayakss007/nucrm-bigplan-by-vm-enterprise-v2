/**
 * #3228 — the send sinks and paid AI hydrations that #3224 left behind.
 *
 * #3224 put `isNull(<table>.deletedAt)` on the lead-warming and auto-followup reads. The same
 * question asked of every other path that produces a recipient address or pays for a generation
 * finds seven sites that still resolve a soft-deleted contact: the invoice mailer, the offer
 * mailer, the deal-won congrats mail, the CSAT survey mail, the workflow `send_email` action, and
 * the AI draft/summarize hydrations.
 *
 * Two kinds of assertion, because each catches what the other cannot:
 *
 *  - Behaviour. The fake below resolves a row the way Postgres would for this one column: a
 *    fixture with `deletedAt` set is returned unless the rendered SQL asks for the tombstone. So
 *    the mailer tests are red while the predicate is missing and green once it is there — they
 *    cannot be satisfied by a canned row set.
 *  - A source screen over all seven files. Three of the sinks live in route handlers whose rest
 *    is a dozen unrelated tables, and driving them would test the harness rather than the query;
 *    the screen asserts on the statement text instead, and accepts BOTH spellings the repo uses
 *    (`isNull(x.deletedAt)` and ``sql`x.deletedAt IS NULL` ``) because `email/templates/bulk-send`
 *    and `deals/[id]` already write the second form for the rows they do guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const INVOICE_ID = 'b2222222-2222-4222-8222-222222222222';
const QUOTE_ID = 'c3333333-3333-4333-8333-333333333333';
const WORKFLOW_ID = 'd4444444-4444-4444-8444-444444444444';
const CONTACT_ID = 'e5555555-5555-4555-8555-555555555555';
const dialect = new PgDialect({} as never);

type Row = Record<string, unknown>;

/** Filled in by the module body; read lazily by the `@/drizzle/db` mock below. */
const dbRef: { current?: Record<string, unknown> } = {};

const state: {
  /** The contact every path hydrates. `deletedAt` set means it is in the trash. */
  contact: Row | null;
  invoice: Row | null;
  quote: Row | null;
  workflow: Row | null;
  queries: { table: string; sql: string }[];
  inserts: { table: string; values: Row }[];
} = { contact: null, invoice: null, quote: null, workflow: null, queries: [], inserts: [] };

/** A row the fake will hand back only if the query actually excludes tombstoned rows. */
function resolveRows(table: string, sql: string): Row[] {
  state.queries.push({ table, sql });
  const row = table === 'contacts' ? state.contact
    : table === 'invoices' ? state.invoice
    : table === 'quotes' ? state.quote
    : table === 'workflows' ? state.workflow
    : null;
  if (!row) return [];
  const wantsLive = /"deleted_at"\s+is\s+null/i.test(sql);
  if (row.deletedAt && wantsLive) return [];
  // A read that never asks about deleted_at sees the row — which is the bug, replayed.
  return [row];
}

type Chain = Record<string, unknown>;

function selectChain(fields?: Record<string, unknown>): Chain {
  let table = '';
  let sql = '';
  const node: Chain = {};
  const self = (..._a: unknown[]) => node;
  for (const m of ['limit', 'orderBy', 'offset', 'groupBy', 'innerJoin', 'leftJoin', 'getRightColumn']) node[m] = self;
  node['from'] = (t: unknown) => { table = getTableName(t as never); return node; };
  node['where'] = (pred: unknown) => {
    sql = dialect.sqlToQuery(pred as never).sql;
    return node;
  };
  // `.select({ status: invoices.status })` names the table without a `.from` in some paths.
  const fromFields = Object.values(fields ?? {}).find((v) => (v as { table?: unknown })?.table);
  if (fromFields) table = getTableName((fromFields as { table: never }).table);
  node['then'] = (resolve: (v: Row[]) => unknown) => Promise.resolve(resolveRows(table, sql)).then(resolve);
  return node;
}

const db: Record<string, unknown> = {
  select: (fields?: Record<string, unknown>) => selectChain(fields),
  insert: (table: unknown) => ({
    values: (values: Row) => {
      state.inserts.push({ table: getTableName(table as never), values });
      const node: Chain = {
        returning: () => Promise.resolve([{ id: 'r-1' }]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ id: 'r-1' }]).then(resolve),
      };
      return node;
    },
  }),
  update: () => {
    const node: Chain = {
      set: () => node,
      where: () => node,
      returning: () => Promise.resolve([]),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve),
    };
    return node;
  },
  query: {
    invoices: { findFirst: async ({ where }: { where?: unknown } = {}) =>
      resolveRows('invoices', where ? dialect.sqlToQuery(where as never).sql : '')[0] ?? null },
    quotes: { findFirst: async ({ where }: { where?: unknown } = {}) =>
      resolveRows('quotes', where ? dialect.sqlToQuery(where as never).sql : '')[0] ?? null },
    contacts: { findFirst: async ({ where }: { where?: unknown } = {}) => {
      const sql = where ? dialect.sqlToQuery(where as never).sql : '';
      state.queries.push({ table: 'contacts', sql });
      const row = state.contact;
      if (!row) return null;
      return row.deletedAt && /"deleted_at"\s+is\s+null/i.test(sql) ? null : row;
    } },
  },
  transaction: async (cb: (t: unknown) => unknown) => cb(db),
};
dbRef.current = db;

// `vi.mock` factories run before this module's body, so the fake is handed over through a
// reference that the body fills in below.
vi.mock('@/drizzle/db', () => ({
  db: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => dbRef.current?.[prop as string],
  }),
}));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/capture-error', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1', role: 'admin' })),
  requireCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return { apiError: vi.fn((err: unknown) => NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) }, { status: 500 },
  )) };
});
vi.mock('@/lib/offers', () => ({
  generatePublicToken: vi.fn(() => 'tok-1'),
  publicOfferUrl: vi.fn(() => 'https://offers.test/o/tok-1'),
  patchOfferMetadata: vi.fn(async () => undefined),
  readOfferMetadata: vi.fn(() => ({})),
  canTransition: vi.fn(() => true),
  allowedFromStatus: vi.fn(() => ['draft']),
}));

import { sendEmail } from '@/lib/email/service';
import { POST as sendInvoice } from '@/app/api/tenant/invoices/[id]/send/route';
import { POST as sendOffer } from '@/app/api/tenant/offers/[quoteId]/send/route';
import { executeWorkflow } from '@/lib/automation/workflow-executor';
import { hydrateDraftContext } from '@/lib/ai/draft';
import { summarizeEntity } from '@/lib/ai/summarize';
import { chat } from '@/lib/ai/gateway';

vi.mock('@/lib/ai/gateway', () => ({
  chat: vi.fn(async () => ({ text: 'a draft', model: 'test' })),
}));

const liveContact = (over: Row = {}): Row => ({
  id: CONTACT_ID, tenantId: TENANT, firstName: 'Buyer', lastName: 'One',
  email: 'buyer@example.test', phone: '+15550100', doNotContact: false,
  unsubscribed: false, companyId: null, leadStatus: 'open', tags: [],
  ...over,
});

const trashedContact = (): Row => liveContact({ deletedAt: new Date('2026-10-01T00:00:00Z') });

function req(url: string, body: Record<string, unknown>): NextRequest {
  return new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.queries = [];
  state.inserts = [];
  state.contact = liveContact();
  state.invoice = {
    id: INVOICE_ID, tenantId: TENANT, contactId: CONTACT_ID, title: 'September services',
    invoiceNumber: 'INV-0001', totalAmount: '250.00', status: 'draft', dueDate: null,
  };
  state.quote = {
    id: QUOTE_ID, tenantId: TENANT, contactId: CONTACT_ID, title: 'Website build',
    metadata: {}, status: 'draft', expiresAt: null,
  };
  state.workflow = {
    id: WORKFLOW_ID, tenantId: TENANT, status: 'active', name: 'Welcome',
    nodes: [
      { id: 'trg', type: 'trigger', data: {} },
      { id: 'a', type: 'action_send_email', data: { subject: 'Hi', body: 'Welcome aboard' } },
    ],
    edges: [{ id: 'e1', source: 'trg', target: 'a', sourceHandle: 'out' }],
  };
  vi.mocked(sendEmail).mockResolvedValue({ success: true, provider: 'smtp', messageId: 'msg-1' });
});

describe('#3228 — the invoice mailer must not derive a recipient from a trashed contact', () => {
  const call = (body: Record<string, unknown>) => sendInvoice(req(
    `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/send`, body,
  ), { params: Promise.resolve({ id: INVOICE_ID }) });

  it('asks Postgres for a live contact when it resolves the recipient', async () => {
    await call({});
    const read = state.queries.find(q => q.table === 'contacts' && /deleted_at|"contacts"\."id"/.test(q.sql));
    expect(read?.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(read?.sql).toMatch(/"contacts"\."id"/i);
  });

  it('refuses to mail when the only recipient is in the trash', async () => {
    state.contact = trashedContact();
    const res = await call({});
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still mails an invoice whose contact is live', async () => {
    const res = await call({});
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0]![0]).toMatchObject({ to: 'buyer@example.test' });
  });
});

describe('#3228 — the offer mailer must not derive a recipient from a trashed contact', () => {
  const call = (body: Record<string, unknown>) => sendOffer(req(
    `http://localhost:3000/api/tenant/offers/${QUOTE_ID}/send`, body,
  ), { params: Promise.resolve({ quoteId: QUOTE_ID }) });

  it('asks Postgres for a live contact when it resolves the recipient', async () => {
    await call({});
    const read = state.queries.find(q => q.table === 'contacts' && /"contacts"\."id"/.test(q.sql));
    expect(read?.sql).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('refuses to mail the offer when the only recipient is in the trash', async () => {
    state.contact = trashedContact();
    const res = await call({});
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('#3228 — the workflow send_email action hydrates a live contact', () => {
  it('excludes trashed contacts from the context hydration', async () => {
    await executeWorkflow({ tenantId: TENANT, userId: 'member-1', workflowId: WORKFLOW_ID, contactId: CONTACT_ID });
    const hydration = state.queries.find(q => q.table === 'contacts');
    expect(hydration?.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(hydration?.sql).toMatch(/"contacts"\."tenant_id"/i);
  });

  it('fails the action instead of mailing a trashed contact', async () => {
    state.contact = trashedContact();
    await executeWorkflow({ tenantId: TENANT, userId: 'member-1', workflowId: WORKFLOW_ID, contactId: CONTACT_ID });
    expect(sendEmail).not.toHaveBeenCalled();
    const log = state.inserts.find(i => /workflow_action_logs/.test(i.table));
    expect(log?.values.status).toBe('failed');
  });

  it('still sends when the contact is live', async () => {
    await executeWorkflow({ tenantId: TENANT, userId: 'member-1', workflowId: WORKFLOW_ID, contactId: CONTACT_ID });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0]![0]).toMatchObject({ to: 'buyer@example.test' });
  });
});

describe('#3228 — AI generation is not paid for over a trashed row', () => {
  it('hydrateDraftContext excludes the contact it is asked to hydrate', async () => {
    const ctx = await hydrateDraftContext(TENANT, 'member-1', { entityType: 'contact', entityId: CONTACT_ID });
    const contactRead = state.queries.find(q => q.table === 'contacts');
    expect(contactRead?.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(ctx.contact).toBeTruthy();
  });

  it('hydrateDraftContext leaves a trashed contact out of the prompt context', async () => {
    state.contact = trashedContact();
    const ctx = await hydrateDraftContext(TENANT, 'member-1', { entityType: 'contact', entityId: CONTACT_ID });
    expect(ctx.contact).toBeUndefined();
  });

  it('summarizeEntity reports a trashed contact as missing and never calls the model', async () => {
    state.contact = trashedContact();
    await expect(summarizeEntity(TENANT, 'member-1', 'contact', CONTACT_ID)).rejects.toThrow(/not found/i);
    expect(chat).not.toHaveBeenCalled();
  });

  it('summarizeEntity still summarises a live contact', async () => {
    const out = await summarizeEntity(TENANT, 'member-1', 'contact', CONTACT_ID);
    expect(out).toBeTruthy();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

// ── Screen ───────────────────────────────────────────────────────────────────
// Three of the sinks (deal-won mail, CSAT survey, the deal/tickets contact joins) sit inside route
// handlers whose remaining tables would all have to be faked to reach the line, which would test
// the harness rather than the query. Those get asserted on the statement text instead.
// Per file, the tables whose rows this PR's paths actually use: the recipient address, the
// hydration that becomes a mail body, or the record the generation is paid for. `tickets/[id]`
// also lists related deals and invoices for the ticket page — a display read, which #3228
// explicitly leaves to the display triage, so it is not in this screen's table set.
const FILE_TABLES: Record<string, readonly string[]> = {
  'app/api/tenant/invoices/[id]/send/route.ts': ['contacts'],
  'app/api/tenant/offers/[quoteId]/send/route.ts': ['contacts'],
  'app/api/tenant/deals/[id]/route.ts': ['contacts'],
  'app/api/tenant/tickets/[id]/route.ts': ['contacts'],
  'lib/automation/workflow-executor.ts': ['contacts', 'deals'],
  'lib/ai/draft.ts': ['contacts', 'companies', 'deals'],
  'lib/ai/summarize.ts': ['contacts', 'companies', 'deals'],
};

/**
 * The text of each statement that reads `table` in `src`: for a query-builder read, from its
 * `.select(` down to the next `;`; for a relational read, the `findFirst` call itself.
 */
function statementBlocks(srcRaw: string, table: string): string[] {
  // Comments are not SQL, and a `;` inside one (as in the #2525 note in `tickets/[id]`) would
  // otherwise truncate a block before its WHERE.
  const src = srcRaw.replace(/\/\/[^\n]*/g, '');
  const blocks: string[] = [];
  const from = `.from(${table})`;
  let i = 0;
  while ((i = src.indexOf(from, i)) !== -1) {
    const start = Math.max(src.lastIndexOf('.select(', i), src.lastIndexOf('db.', i));
    const semi = src.indexOf(';', i);
    blocks.push(src.slice(start === -1 ? i : start, semi === -1 ? i + 500 : semi));
    i += from.length;
  }
  for (const method of ['findFirst', 'findMany']) {
    const rel = `query.${table}.${method}`;
    let j = 0;
    while ((j = src.indexOf(rel, j)) !== -1) {
      blocks.push(src.slice(j, src.indexOf('})', j) + 2 === -1 ? j + 400 : src.indexOf('})', j) + 2));
      j += rel.length;
    }
  }
  return blocks;
}

const TOMBSTONE: Record<string, RegExp> = {
  // The repo writes the exclusion two ways; a screen that only knows one shouts at correct code
  // (`app/api/tenant/email/templates/bulk-send/route.ts:81` and `deals/[id]` use the raw form).
  contacts: /isNull\(contacts\.deletedAt\)|contacts\.deletedAt\}\s+IS\s+NULL/i,
  companies: /isNull\(companies\.deletedAt\)|companies\.deletedAt\}\s+IS\s+NULL/i,
  deals: /isNull\(deals\.deletedAt\)|deals\.deletedAt\}\s+IS\s+NULL/i,
};

describe('#3228 screen — no outbound module may resolve a soft-deleted row it mails or pays for', () => {
  for (const [file, tables] of Object.entries(FILE_TABLES)) {
    const src = readFileSync(file, 'utf8');
    for (const table of tables) {
      const reads = statementBlocks(src, table);
      if (reads.length === 0) continue;
      it(`${file}: all ${reads.length} ${table} reads exclude the tombstone`, () => {
        for (const block of reads) {
          expect(
            TOMBSTONE[table].test(block),
            `${file} reads ${table} with no deleted_at exclusion:\n${block.slice(0, 400)}`,
          ).toBe(true);
        }
      });
    }
  }
});

/**
 * POST /api/leads/public — #2334
 *
 * Three defects on the unauthenticated lead-capture endpoint, all reached by
 * supplying `form_id`:
 *
 *  1. `contactId: leadId` wrote a LEAD id into `form_submissions.contact_id`,
 *     whose FK points at `contacts.id` (validated on the live DB), so every
 *     submission died in 23503 — after the lead had already been committed in a
 *     separate transaction — and the visitor got a 500.
 *  2. `form_id` was never checked against `tenant_id`, the form's active flag,
 *     or its soft-delete, so `forms.submissions_count` could be bumped on any
 *     foreign form and a submission row stamped with another workspace's form.
 *  3. A non-uuid `form_id` reached `eq(forms.id, …)` and surfaced `22P02` as a
 *     500 — the same class closed for /api/forms/submit in #2288.
 *
 * The capture and the submission must also be ONE atomic unit: the form check
 * runs before any write, and the submission is recorded inside the capture
 * transaction, on both the new-lead and the repeat-submission path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const FORM_ID = '30000000-0000-4000-8000-000000000001';
const LEAD_ID = '40000000-0000-4000-8000-000000000001';
const COMPANY_ID = '50000000-0000-4000-8000-000000000001';

const harness = vi.hoisted(() => ({
  state: {
    /** row returned by db.query.forms.findFirst — undefined means "no such form for this tenant" */
    formRow: null as unknown,
    /** row returned by the in-transaction leads lookup — non-null takes the repeat-submission path */
    existingLead: null as unknown,
    formLookupWhere: [] as unknown[],
    txInserts: [] as { table: string; values: Record<string, unknown> }[],
    txUpdates: [] as { table: string; set: Record<string, unknown>; where: unknown }[],
    dbInserts: [] as { table: string; values: Record<string, unknown> }[],
    transactions: 0,
  },
  tableOf: (table: unknown): string => {
    // drizzle stamps the SQL name on the table under this well-known symbol;
    // reading it keeps the assertions about WHICH table was written to honest.
    const name = (table as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : 'unknown';
  },
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));

const sqlText = (arg: unknown): string =>
  new PgDialect().sqlToQuery(arg as Parameters<PgDialect['sqlToQuery']>[0]).sql;

vi.mock('@/drizzle/db', () => {
  const makeTx = () => ({
    execute: async () => undefined,
    query: {
      leads: { findFirst: async () => harness.state.existingLead },
      contacts: { findFirst: async () => null },
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        harness.state.txInserts.push({ table: harness.tableOf(table), values });
        return { returning: async () => [{ id: LEAD_ID }] };
      },
    }),
    update: (table: unknown) => ({
      set: (setValues: Record<string, unknown>) => ({
        where: (where: unknown) => {
          harness.state.txUpdates.push({ table: harness.tableOf(table), set: setValues, where });
          return Object.assign(Promise.resolve([]), { returning: async () => [{ id: LEAD_ID }] });
        },
      }),
    }),
  });

  return {
    db: {
      // `limitCheck` only: db.select(...).from(...).innerJoin(...).where(...).then(...)
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ currentContacts: 1, maxContacts: 1000 }]),
          }),
        }),
      }),
      query: {
        tenants: { findFirst: async () => ({ id: TENANT_ID, name: 'Acme', ownerId: null }) },
        forms: {
          findFirst: async (cfg: { where?: unknown }) => {
            if (cfg?.where !== undefined) harness.state.formLookupWhere.push(cfg.where);
            return harness.state.formRow;
          },
        },
        companies: { findFirst: async () => ({ id: COMPANY_ID }) },
      },
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          harness.state.dbInserts.push({ table: harness.tableOf(table), values });
          return { returning: async () => [{ id: COMPANY_ID }] };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        harness.state.transactions += 1;
        return fn(makeTx());
      },
    },
  };
});

function post(payload: unknown): NextRequest {
  return new Request('http://localhost/api/leads/public', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

async function handler(): Promise<(request: NextRequest) => Promise<Response>> {
  const mod = await import('@/app/api/leads/public/route');
  return mod.POST as unknown as (request: NextRequest) => Promise<Response>;
}

const capture = (extra: Record<string, unknown> = {}) => ({
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'Ada@Example.com',
  tenant_id: TENANT_ID,
  ...extra,
});

describe('POST /api/leads/public — form scoping and submission integrity (#2334)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.formRow = { id: FORM_ID, tenantId: TENANT_ID };
    harness.state.existingLead = null;
    harness.state.formLookupWhere = [];
    harness.state.txInserts = [];
    harness.state.txUpdates = [];
    harness.state.dbInserts = [];
    harness.state.transactions = 0;
  });

  it('records the submission without writing a lead id into contact_id', async () => {
    const res = await (await handler())(post(capture({ form_id: FORM_ID })));
    expect(res.status).toBe(201);

    const submission = harness.state.txInserts.find((i) => i.table === 'form_submissions');
    expect(submission, 'form submission recorded').toBeDefined();
    // The 23503: a leads.id in a column with FK -> contacts.id.
    expect(submission!.values).not.toHaveProperty('contactId');
    expect(submission!.values.tenantId).toBe(TENANT_ID);
    expect(submission!.values.formId).toBe(FORM_ID);
  });

  it('writes the submission inside the capture transaction — one atomic unit', async () => {
    await (await handler())(post(capture({ form_id: FORM_ID })));
    // One db.transaction() for the whole capture; the submission went through tx,
    // so a rejected submission rolls the lead back instead of stranding it.
    expect(harness.state.transactions).toBe(1);
    expect(harness.state.txInserts.map((i) => i.table)).toContain('form_submissions');
    expect(harness.state.dbInserts.map((i) => i.table)).not.toContain('form_submissions');
  });

  it('bumps submissions_count with a tenant predicate, not a bare id', async () => {
    await (await handler())(post(capture({ form_id: FORM_ID })));
    const counter = harness.state.txUpdates.find((u) => u.table === 'forms');
    expect(counter, 'forms counter update issued').toBeDefined();
    const sql = sqlText(counter!.where);
    expect(sql).toContain('"forms"."id"');
    expect(sql).toContain('"forms"."tenant_id"');
  });

  it('rejects a form that is not the caller tenant’s / inactive / deleted BEFORE writing anything', async () => {
    harness.state.formRow = undefined;
    const res = await (await handler())(post(capture({ form_id: FORM_ID })));
    expect(res.status).toBe(404);
    // No lead, no company, no submission, no counter — the ownership check gates
    // the whole write path, so the crash can never re-open cross-tenant writes.
    expect(harness.state.txInserts).toEqual([]);
    expect(harness.state.txUpdates).toEqual([]);
    expect(harness.state.dbInserts).toEqual([]);
    expect(harness.state.transactions).toBe(0);
  });

  it('asks the form lookup for active, non-deleted rows owned by tenant_id', async () => {
    await (await handler())(post(capture({ form_id: FORM_ID })));
    expect(harness.state.formLookupWhere).toHaveLength(1);
    const sql = sqlText(harness.state.formLookupWhere[0]);
    expect(sql).toContain('"forms"."tenant_id"');
    expect(sql).toContain('"forms"."is_active"');
    expect(sql).toContain('"forms"."deleted_at"');
  });

  it('answers 400 for a form_id that cannot name a uuid instead of leaking 22P02 as a 500', async () => {
    const res = await (await handler())(post(capture({ form_id: 'abc' })));
    expect(res.status).toBe(400);
    expect(harness.state.formLookupWhere, 'never reaches Postgres with a malformed id').toEqual([]);
    expect(harness.state.txInserts).toEqual([]);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/uuid|22P02|invalid input syntax/i);
  });

  it('still records a submission when the email already has a lead', async () => {
    harness.state.existingLead = {
      id: LEAD_ID, tags: [], leadStatus: 'new', formSubmissionsCount: 1,
    };
    const res = await (await handler())(post(capture({ form_id: FORM_ID })));
    expect(res.status).toBe(201);
    expect(harness.state.txInserts.map((i) => i.table)).toContain('form_submissions');
    expect(harness.state.txUpdates.map((u) => u.table)).toEqual(['leads', 'forms']);
  });

  it('is unchanged for the no-form capture path', async () => {
    harness.state.formRow = undefined;
    const res = await (await handler())(post(capture()));
    expect(res.status).toBe(201);
    expect(harness.state.formLookupWhere).toEqual([]);
    expect(harness.state.txInserts.map((i) => i.table)).toEqual(['leads', 'lead_activities']);
    expect(harness.state.txUpdates).toEqual([]);
  });
});

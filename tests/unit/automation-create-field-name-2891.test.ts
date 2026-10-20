/**
 * #2891 — `POST /api/tenant/automations` refuses the body the Automation dialog sends, and the
 * PATCH beside it writes fields the client never mentioned.
 *
 * WHAT WAS WRONG
 * --------------
 * `createAutomationSchema` declared the trigger as `event: requiredString.max(100)`. Nothing has
 * ever sent that name: the dialog's form state (`app/tenant/automation/page.tsx:82-87`, posted
 * whole at `:149-153`), the SDK (`lib/integrations/sdk.ts:192-195`), the column
 * (`drizzle/schema/automation.ts:20`) and the engine that matches on it
 * (`lib/automation/engine.ts:71`, `eq(automations.triggerType, payload.event)`) all call it
 * `trigger_type`. A required key no client sends is an endpoint that cannot be called: every
 * New Automation answered `400 Validation failed` on the `event` field.
 *
 * Meanwhile the two routes wrote the trigger from the *raw* body
 * (`route.ts:100-101`, `app/api/tenant/automations/[id]/route.ts:123-124`) — so the one field that
 * mattered was the one the schema never saw, and a caller that did send `event` got a 201 whose
 * `trigger_type` fell through to the column default `'event'`, a string no emitted event ever
 * equals: an active, well-formed automation that can never fire.
 *
 * And `updateAutomationSchema = createAutomationSchema.partial()` inherited the create-time
 * `.default()`s — `.partial()` does not remove a default — so a PATCH body that mentioned nothing
 * parsed to `{ conditions: [], is_active: true }` and the handler wrote both back. Pausing an
 * automation from the dialog deleted its conditions. That is #2627's shape, still live on this
 * table.
 *
 * HOW THIS TESTS IT
 * -----------------
 * The real `validateBody`, the real schemas and the real route handlers run against the body the
 * dialog builds, with drizzle mocked just enough to record what would have been written. Nothing
 * here asserts a shape a test invented: the first assertion in each group is the page's own
 * `useState` initial value.
 *
 * WHAT THIS DOES NOT DECIDE
 * -------------------------
 * Which trigger values the dialog *should* offer. `automations.trigger_type` has no CHECK
 * constraint and stays free-text; the dialog's 14 labels
 * (`app/tenant/automation/page.tsx:18-28`), the engine's 12-member `TriggerEvent` union
 * (`lib/automation/engine.ts:44-49`) and the 6 events actually passed to `evaluateAutomations`
 * disagree in both directions, and that vocabulary is #2806's parked decision. `trigger_type` is
 * therefore validated as a bounded string, exactly as `event` was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { createAutomationSchema, updateAutomationSchema } from '@/lib/api/schemas';
import { automations } from '@/drizzle/schema';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const ID = 'c3333333-3333-4333-8333-333333333333';

const { state, db } = vi.hoisted(() => {
  const state = {
    inserts: [] as Array<{ table: unknown; rows: Record<string, unknown> }>,
    updates: [] as Array<{ table: unknown; rows: Record<string, unknown> }>,
  };

  /** `insert(table).values(payload)` — the payload is what this file is about, so keep it. */
  function insertable(table: unknown) {
    return {
      values: (rows: unknown) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const typed = list.map((row) => row as Record<string, unknown>);
        state.inserts.push(...typed.map((row) => ({ table, rows: row })));
        return { returning: () => Promise.resolve(typed.map((row) => ({ id: 'row-inserted', ...row }))) };
      },
    };
  }

  return {
    state,
    db: {
      insert: insertable,
      // `.set(payload).where(cond).returning()` — the PATCH route's whole interest is `set`.
      update: (table: unknown) => ({
        set: (rows: Record<string, unknown>) => {
          state.updates.push({ table, rows });
          return {
            where: () => ({ returning: () => Promise.resolve([{ id: ID, ...rows }]) }),
          };
        },
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      query: { automations: { findMany: async () => [] } },
    },
  };
});

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1', isSuperAdmin: false })),
  // Both are synchronous and return null for "allowed"; an async mock would hand the route a
  // truthy Promise and every write would answer the promise's resolution — which is nothing.
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H>(handler: H): H => handler }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

import { POST as postAutomation } from '@/app/api/tenant/automations/route';
import { PATCH as patchAutomation } from '@/app/api/tenant/automations/[id]/route';

/**
 * The New Automation dialog's state, copied from `app/tenant/automation/page.tsx:82-87` — the
 * initial value with the two fields an operator would type. `useState` is not importable from a
 * page, so the last describe in this file reads the page and fails if its form stops carrying
 * what the schema requires, which is what keeps this honest.
 */
const DIALOG_FORM = {
  name: 'Welcome email',
  description: 'Send the welcome mail when a contact lands',
  trigger_type: 'contact.created',
  is_active: true,
  actions: [{ type: 'send_email', config: { template: 'welcome' } }],
};

const request = (url: string, body: unknown, method = 'POST') =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const patch = (body: unknown) =>
  patchAutomation(request('http://localhost/api/tenant/automations/[id]', body, 'PATCH'), {
    params: Promise.resolve({ id: ID }),
  });

/** The 400 `validateBody` answers, with the field names it complained about. */
async function fieldsOf(res: Response): Promise<string[]> {
  const json = await res.json() as { details?: Array<{ field: string }> };
  return (json.details ?? []).map((d) => d.field);
}

beforeEach(() => {
  state.inserts = [];
  state.updates = [];
});

describe('createAutomationSchema takes the name the dialog uses (#2891)', () => {
  it('accepts the dialog body and keeps its trigger', () => {
    const parsed = createAutomationSchema.parse(DIALOG_FORM);
    expect(parsed.trigger_type).toBe('contact.created');
    // `trigger_config` is declared now, so the jsonb has a bound instead of arriving unvalidated.
    expect(parsed.trigger_config).toEqual({});
  });

  it('accepts the SDK’s documented body, which sends nothing optional', () => {
    const parsed = createAutomationSchema.parse({
      name: 'Welcome',
      trigger_type: 'contact.created',
      actions: [{ type: 'email' }],
    });
    expect(parsed).toMatchObject({ trigger_type: 'contact.created', is_active: true });
  });

  it('still requires a trigger, because a row without one can never match an event', () => {
    const result = createAutomationSchema.safeParse({ ...DIALOG_FORM, trigger_type: undefined });
    expect(result.success).toBe(false);
  });

  it('refuses the old `event` spelling rather than storing the unfireable default', () => {
    // This is the body that used to reach the database: `event` satisfied the schema, the raw
    // `trigger_type` read found nothing, and the column default `'event'` was written — an
    // automation the engine cannot ever select (`lib/automation/engine.ts:71`).
    const result = createAutomationSchema.safeParse({
      name: 'Welcome', event: 'contact.created', actions: [{ type: 'email' }],
    });
    expect(result.success).toBe(false);
    expect('event' in createAutomationSchema.shape).toBe(false);
  });
});

describe('POST /api/tenant/automations with the dialog’s body (#2891)', () => {
  it('creates the automation with the trigger the operator picked', async () => {
    const res = await postAutomation(request('http://localhost/api/tenant/automations', DIALOG_FORM));
    expect(res.status).toBe(201);

    const [row] = state.inserts;
    expect(row?.table).toBe(automations);
    expect(row?.rows).toMatchObject({
      tenantId: TENANT,
      name: 'Welcome email',
      triggerType: 'contact.created',
      triggerConfig: {},
      actions: [{ type: 'send_email', config: { template: 'welcome' } }],
      conditions: [],
      isActive: true,
      createdBy: 'member-1',
    });
    // Before the fix this was `undefined` for every request the dialog could make.
    expect(row?.rows['triggerType']).toBeDefined();
  });

  it('answers the `event` body with a 400 and writes no unfireable row', async () => {
    const res = await postAutomation(request('http://localhost/api/tenant/automations', {
      name: 'Welcome', description: '', event: 'contact.created', is_active: true,
      actions: [{ type: 'send_email', config: {} }],
    }));
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toContain('trigger_type');
    expect(state.inserts, 'a rejected create must not have reached the database').toEqual([]);
  });

  it('validates trigger_config instead of passing it through to the jsonb column', async () => {
    // A string where an object belongs used to be inserted verbatim; only
    // `chk_automations_trigger_config_size` (0055_jsonb_size_limits.sql:72-73) saw it, and a
    // short string is under that limit, so it stored happily and every reader that assumes an
    // object got a scalar.
    const res = await postAutomation(request('http://localhost/api/tenant/automations', {
      ...DIALOG_FORM, trigger_config: 'not-an-object',
    }));
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toContain('trigger_config');
    expect(state.inserts).toEqual([]);
  });

  it('trims the trigger the way the rest of the schema does', async () => {
    await postAutomation(request('http://localhost/api/tenant/automations', {
      ...DIALOG_FORM, trigger_type: '  deal.won  ',
    }));
    expect(state.inserts[0]?.rows['triggerType']).toBe('deal.won');
  });
});

describe('PATCH /api/tenant/automations/[id] changes only what the body names (#2891)', () => {
  it('pausing does not delete the conditions the automation was built with', async () => {
    // The dialog's Active/Inactive switch (`app/tenant/automation/page.tsx:126-131`) sends this
    // body alone. `conditions` was synthesised from `.default([])` and written back over the
    // stored row: the switch did not pause the automation, it reset it.
    const res = await patch({ is_active: false });
    expect(res.status).toBe(200);

    const [row] = state.updates;
    expect(row?.table).toBe(automations);
    expect(row?.rows).toMatchObject({ isActive: false });
    expect(row?.rows).not.toHaveProperty('conditions');
    expect(row?.rows).not.toHaveProperty('actions');
    expect(row?.rows).not.toHaveProperty('triggerConfig');
    expect(row?.rows).not.toHaveProperty('triggerType');
  });

  it('an empty PATCH writes no field but the timestamp', async () => {
    await patch({});
    expect(Object.keys(state.updates[0]?.rows ?? {})).toEqual(['updatedAt']);
  });

  it('stores the validated trigger rather than the raw body', async () => {
    const res = await patch({ trigger_type: '  invoice.paid  ' });
    expect(res.status).toBe(200);
    expect(state.updates[0]?.rows).toMatchObject({ triggerType: 'invoice.paid' });
  });

  it('refuses a bad trigger_config before the update, and updates nothing', async () => {
    const res = await patch({ trigger_config: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toContain('trigger_config');
    expect(state.updates, 'a rejected PATCH must not have written a column').toEqual([]);
  });

  it('keeps an explicitly sent conditions array (the gate is presence, not truthiness)', async () => {
    const res = await patch({ conditions: [{ field: 'country', operator: 'eq', value: 'IN' }] });
    expect(res.status).toBe(200);
    expect(state.updates[0]?.rows).toMatchObject({
      conditions: [{ field: 'country', operator: 'eq', value: 'IN' }],
    });
  });
});

describe('updateAutomationSchema omits what the body omitted (#2891)', () => {
  // #2627 learned this the hard way on deals: `.partial()` makes a key optional, it does not
  // remove its `.default()`, so the parsed object is *bigger* than the request. The route then
  // cannot tell "the client sent nothing" from "the client sent the default", and it wrote the
  // defaults back over the stored row. Pinned here at the schema, not only through the route.
  it('leaves an omitted conditions out of the parsed output', () => {
    const parsed = updateAutomationSchema.parse({ is_active: false });
    expect('conditions' in parsed).toBe(false);
    expect('trigger_config' in parsed).toBe(false);
    expect(parsed.is_active).toBe(false);
  });

  it('parses an empty body to nothing at all', () => {
    expect(updateAutomationSchema.parse({})).toEqual({});
  });

  it('keeps a value the client did send, including a false one', () => {
    expect(updateAutomationSchema.parse({ is_active: false })).toMatchObject({ is_active: false });
    expect(updateAutomationSchema.parse({ conditions: [] })).toMatchObject({ conditions: [] });
  });

  it('createAutomationSchema still defaults conditions=[] and is_active=true on POST', () => {
    const parsed = createAutomationSchema.parse({
      name: 'Welcome', trigger_type: 'contact.created', actions: [{ type: 'email' }],
    });
    expect(parsed).toMatchObject({ conditions: [], is_active: true, trigger_config: {} });
  });
});

describe('the dialog, the schema and the routes stay in the same language (#2891)', () => {
  const pageSrc = readFileSync('app/tenant/automation/page.tsx', 'utf8');
  const postRoute = readFileSync('app/api/tenant/automations/route.ts', 'utf8');
  const patchRoute = readFileSync('app/api/tenant/automations/[id]/route.ts', 'utf8');

  it('requires no field the dialog does not send', () => {
    // The invariant whose violation is #2891: a required schema key the page never posts makes the
    // endpoint uncallable from the UI, and no test of the page can see it because the page never
    // gets a body the route likes. Anything newly required has to appear in the page too.
    const required = Object.entries(createAutomationSchema.shape)
      .filter(([, field]) => !field.isOptional())
      .map(([key]) => key);
    expect(required.length, 'the schema lost every required field').toBeGreaterThan(0);
    for (const key of required) {
      expect(pageSrc, `the dialog cannot send '${key}', so the schema must not require it`)
        .toContain(`${key}:`);
    }
  });

  it('declares the trigger under the name every writer uses', () => {
    expect('trigger_type' in createAutomationSchema.shape).toBe(true);
    expect(pageSrc).toContain('trigger_type:');
    // The dialog posts its form object whole, so the schema's names are the form's names — this
    // is why `event` could break the create without breaking anything the page tests.
    expect(pageSrc).toContain('body: JSON.stringify(form)');
  });

  it('reads the trigger from the validated body in both routes', () => {
    // The raw read is how an unvalidated document reached the jsonb column. `rawBody` remains for
    // `expectedUpdatedAt`, which guards the write instead of persisting it.
    for (const src of [postRoute, patchRoute]) {
      expect(src).not.toMatch(/rawBody\[\s*['"]trigger_(?:type|config)['"]\s*\]/);
      expect(src).not.toMatch(/rawBody\.trigger_(?:type|config)/);
    }
    expect(postRoute).toMatch(/triggerType: v\.trigger_type/);
    expect(patchRoute).toMatch(/updateData\['triggerType'\] = body\.trigger_type/);
  });
});

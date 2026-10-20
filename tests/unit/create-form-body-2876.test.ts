/**
 * #2876 — Create Order, Create Quote and New Subscription post fields their own
 * schemas do not accept.
 *
 * All three modals keep camelCase in `useState` and handed that object straight to
 * `JSON.stringify`, while `createOrderSchema` / `createQuoteSchema` /
 * `createSubscriptionSchema` describe snake_case. Zod's object parse drops keys it
 * does not know instead of rejecting them, so the operator's data was gone before the
 * route ever looked at it: orders and quotes failed the `line_items` min(1) rule, and
 * subscriptions tripped its own `if (!startDate)` guard, which could only ever see
 * `undefined` because `start_date` had been stripped along with everything else.
 * Three create forms, none of them able to finish.
 *
 * No test noticed because the write path is tested with snake_case bodies written from
 * the schemas, and `tests/unit/orders-atomic-number-2342.test.ts` stubs `validateBody`
 * to return its input untouched — so the page and the schema were never in the same
 * room. Here the real `validateBody` and the real schemas run, against the payloads
 * `lib/billing/create-payloads.ts` builds for the state the modals actually hold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { orderPayload, quotePayload, subscriptionPayload } from '@/lib/billing/create-payloads';
import { createOrderSchema, createQuoteSchema, createSubscriptionSchema } from '@/lib/api/schemas';
import { orderLineItems, orders, quoteLineItems, quotes, serviceSubscriptions } from '@/drizzle/schema';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const CONTACT = 'b2222222-2222-4222-8222-222222222222';

const { state, db } = vi.hoisted(() => {
  const state = {
    inserts: [] as Array<{ table: unknown; rows: Record<string, unknown> }>,
    maxNum: 7,
  };

  /** Passthrough drizzle chain whose terminal call resolves `rows`. */
  function chain(rows: () => unknown[], terminal: 'limit' | 'returning') {
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res),
    };
    self[terminal === 'limit' ? 'limit' : 'returning'] = () => Promise.resolve(rows());
    return self;
  }

  /** `insert(table).values(payload)` — the payload is what this file is about, so keep it. */
  function insertable(id: string) {
    return (table: unknown) => ({
      values: (rows: unknown) => {
        const list = Array.isArray(rows) ? rows : [rows];
        state.inserts.push(...list.map((row) => ({ table, rows: row as Record<string, unknown> })));
        const first = (list[0] ?? {}) as Record<string, unknown>;
        return chain(() => [{ id, ...first }], 'returning');
      },
    });
  }

  const tx = {
    execute: async () => undefined,
    select: () => chain(() => [{ maxNum: state.maxNum }], 'limit'),
    insert: insertable('row-in-tx'),
  };

  return {
    state,
    db: {
      select: () => chain(() => [], 'limit'),
      insert: insertable('row-outside-tx'),
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1', isSuperAdmin: false })),
  // `requirePerm` is synchronous and returns null when the caller has the permission;
  // making this mock async would hand the route a truthy Promise and every POST would
  // return whatever that promise resolves to — which is nothing.
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H>(handler: H): H => handler }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

import { POST as postOrder } from '@/app/api/tenant/orders/route';
import { POST as postQuote } from '@/app/api/tenant/quotes/route';
import { POST as postSubscription } from '@/app/api/tenant/subscriptions/route';

/**
 * The modals' starting state, copied from each page's `useState`, with the fields an
 * operator would type into it. `useState` is not importable from a page (App Router
 * only lets a page export its default), so these are the strings the inputs hold —
 * and the last describe in this file fails if a page stops building its body out of
 * `lib/billing/create-payloads`, which is what keeps them honest.
 */
const ORDER_FORM = {
  title: 'Widget restock',
  contactId: CONTACT,
  orderDate: '2026-10-19',
  expectedDeliveryDate: '2026-11-02',
  notes: 'Ship to the back dock',
  items: [
    { description: 'Widget A', quantity: '3', unitPrice: '19.99' },
    { description: 'Widget B', quantity: '1', unitPrice: '250' },
  ],
};

const QUOTE_FORM = {
  title: 'Q3 platform quote',
  contactId: CONTACT,
  dealId: '',
  expiresAt: '2026-12-31',
  notes: 'Includes onboarding',
  terms: 'Net 30',
  discount: '500',
  tax: '250',
  items: [{ description: 'Seats', quantity: '10', unitPrice: '120' }],
};

const SUBSCRIPTION_FORM = {
  name: 'Acme monitoring',
  planName: 'Growth annual',
  startDate: '2026-10-19',
  currentPeriodEnd: '2027-10-19',
  amount: '1200.50',
  billingFrequency: 'yearly',
  autoRenew: true,
  paymentMethod: '',
  last4: '',
};

const request = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

/** Which table a recorded insert went into — the drizzle table object is the identity. */
const into = (table: unknown) => state.inserts.filter((i) => i.table === table);

beforeEach(() => {
  state.inserts = [];
  state.maxNum = 7;
});

describe('POST /api/tenant/orders with the Create Order modal’s body (#2876)', () => {
  it('creates the order the operator described', async () => {
    const res = await postOrder(request('http://localhost/api/tenant/orders', orderPayload(ORDER_FORM)));
    expect(res.status).toBe(201);

    const [order] = into(orders);
    expect(order?.rows).toMatchObject({
      title: 'Widget restock',
      contactId: CONTACT,
      orderDate: '2026-10-19',
      expectedDeliveryDate: '2026-11-02',
      notes: 'Ship to the back dock',
      // ORD-00008: MAX(sequence) of the tenant's existing ORD-##### numbers, plus one
      orderNumber: 'ORD-00008',
      subtotal: '309.97',
      totalAmount: '309.97',
    });

    const lineItems = into(orderLineItems);
    expect(lineItems.map((l) => l.rows)).toMatchObject([
      { orderId: 'row-in-tx', description: 'Widget A', quantity: '3', unitPrice: '19.99', total: '59.97', sortOrder: 0 },
      { description: 'Widget B', quantity: '1', unitPrice: '250', total: '250.00', sortOrder: 1 },
    ]);
  });

  it('rejects the body the page used to post — which is why nobody saw it work', async () => {
    // the pre-fix `JSON.stringify({ ...form, subtotal, items })`: camelCase keys,
    // no `line_items`, stripped to nothing by the schema
    const legacy = { ...ORDER_FORM, subtotal: '309.97', items: ORDER_FORM.items };
    const res = await postOrder(request('http://localhost/api/tenant/orders', legacy));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: Array<{ field: string }> };
    expect(body.error).toBe('Validation failed');
    expect(body.details.map((d) => d.field)).toContain('line_items');
    expect(state.inserts, 'a rejected create must not have reached the database').toEqual([]);
  });

  it('keeps the generated title for a client that sends none, and sends no subtotal', async () => {
    const res = await postOrder(request('http://localhost/api/tenant/orders', orderPayload({
      ...ORDER_FORM, title: '', contactId: '', expectedDeliveryDate: '', notes: '',
      items: [{ description: 'One line', quantity: 'abc', unitPrice: '' }],
    })));
    expect(res.status).toBe(201);
    const [order] = into(orders);
    expect(order?.rows).toMatchObject({ title: 'Order ORD-00008', contactId: null, expectedDeliveryDate: null });
    // the blank quantity falls back to 1 rather than reaching Zod as NaN, which would 400
    expect(into(orderLineItems)[0]?.rows).toMatchObject({ quantity: '1', unitPrice: '0' });
  });
});

describe('POST /api/tenant/quotes with the Create Quote modal’s body (#2876)', () => {
  it('creates the quote with its tax and expiry', async () => {
    const res = await postQuote(request('http://localhost/api/tenant/quotes', quotePayload(QUOTE_FORM)));
    expect(res.status).toBe(201);

    const [quote] = into(quotes);
    expect(quote?.rows).toMatchObject({
      title: 'Q3 platform quote',
      contactId: CONTACT,
      quoteNumber: 'QT-00008',
      status: 'draft',
      subtotal: '1200.00',
      discount: '500',
      // the route used to overwrite this with `const tax = 0`
      tax: '250',
      totalAmount: '950.00',
    });
    expect((quote?.rows as { expiresAt: Date }).expiresAt.toISOString().slice(0, 10)).toBe('2026-12-31');

    expect(into(quoteLineItems).map((l) => l.rows)).toMatchObject([
      { description: 'Seats', quantity: '10', unitPrice: '120', total: '1200.00' },
    ]);
  });

  it('rejects the body the page used to post', async () => {
    const res = await postQuote(request('http://localhost/api/tenant/quotes', QUOTE_FORM));
    expect(res.status).toBe(400);
    const body = await res.json() as { details: Array<{ field: string }> };
    expect(body.details.map((d) => d.field)).toContain('line_items');
    expect(state.inserts).toEqual([]);
  });

  it('posts nothing for a deal the modal never asks about', () => {
    // `dealId` sits in the modal's state with no input that writes it and no key in
    // createQuoteSchema — sending it would put a dead key back on the wire
    expect(quotePayload(QUOTE_FORM)).not.toHaveProperty('deal_id');
    expect(quotePayload(QUOTE_FORM)).not.toHaveProperty('dealId');
  });
});

describe('POST /api/tenant/subscriptions with the New Subscription modal’s body (#2876)', () => {
  it('stores the name and the amount instead of Subscription / 0', async () => {
    const res = await postSubscription(
      request('http://localhost/api/tenant/subscriptions', subscriptionPayload(SUBSCRIPTION_FORM)),
    );
    expect(res.status).toBe(201);

    const [subscription] = into(serviceSubscriptions);
    expect(subscription?.rows).toMatchObject({
      name: 'Acme monitoring',
      planName: 'Growth annual',
      // amount is what the panel's MRR/ARR header sums (page.tsx:84-85)
      amount: '1200.5',
      startDate: '2026-10-19',
      currentPeriodStart: '2026-10-19',
      currentPeriodEnd: '2027-10-19',
      billingFrequency: 'yearly',
      autoRenew: true,
      // and it is `active`, so those sums count it — see the status note in the schema
      status: 'active',
    });
  });

  it('takes active for a client that sends no status, and trial for one that means it', async () => {
    const body = subscriptionPayload(SUBSCRIPTION_FORM);
    expect(body).not.toHaveProperty('status');
    expect((await postSubscription(request('http://localhost/api/tenant/subscriptions', body))).status).toBe(201);
    expect(into(serviceSubscriptions)[0]?.rows).toMatchObject({ status: 'active' });

    state.inserts = [];
    const trial = await postSubscription(request('http://localhost/api/tenant/subscriptions', { ...body, status: 'trial' }));
    expect(trial.status).toBe(201);
    expect(into(serviceSubscriptions)[0]?.rows).toMatchObject({ status: 'trial' });
  });

  it('rejects the body the page used to post, at the route’s own guard', async () => {
    const res = await postSubscription(request('http://localhost/api/tenant/subscriptions', SUBSCRIPTION_FORM));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Start date and billing frequency are required',
    });
    expect(state.inserts).toEqual([]);
  });

  it('sends no payment columns, because the modal collects none', () => {
    expect(subscriptionPayload(SUBSCRIPTION_FORM)).not.toHaveProperty('payment_method');
    expect(subscriptionPayload(SUBSCRIPTION_FORM)).not.toHaveProperty('last4');
  });
});

describe('the payload is what the schema describes (#2876)', () => {
  const pairs = [
    ['createOrderSchema', createOrderSchema, orderPayload(ORDER_FORM)],
    ['createQuoteSchema', createQuoteSchema, quotePayload(QUOTE_FORM)],
    ['createSubscriptionSchema', createSubscriptionSchema, subscriptionPayload(SUBSCRIPTION_FORM)],
  ] as const;

  for (const [name, schema, payload] of pairs) {
    it(`${name} accepts every key the builder sends`, () => {
      // Zod strips an unknown key without complaining, so a payload field the schema
      // does not describe is data that disappears with no error anywhere.
      const accepted = new Set(Object.keys(schema.shape));
      const unaccepted = Object.keys(payload).filter((key) => !accepted.has(key));
      expect(unaccepted, `${name} would strip ${unaccepted.join(', ')}`).toEqual([]);
    });
  }

  /** A modal is only covered while it builds its body out of the shared module. */
  const buildsBody = (src: string, builder: string) =>
    src.includes(`import { ${builder} } from '@/lib/billing/create-payloads'`)
    && src.includes(`body: JSON.stringify(${builder}(form))`);

  it('every modal builds its body out of lib/billing/create-payloads', () => {
    const modals: Array<[path: string, builder: string]> = [
      ['app/tenant/orders/page.tsx', 'orderPayload'],
      ['app/tenant/quotes/page.tsx', 'quotePayload'],
      ['app/tenant/subscriptions/page.tsx', 'subscriptionPayload'],
    ];
    for (const [path, builder] of modals) {
      expect(buildsBody(readFileSync(path, 'utf8'), builder), `${path} still posts its raw form`).toBe(true);
    }
  });

  it('convicts a page that went back to stringifying its form (control)', () => {
    const regressed = "import { orderPayload } from '@/lib/billing/create-payloads';\nbody: JSON.stringify(form),";
    const fixed = "import { orderPayload } from '@/lib/billing/create-payloads';\nbody: JSON.stringify(orderPayload(form)),";
    expect(buildsBody(regressed, 'orderPayload')).toBe(false);
    expect(buildsBody(fixed, 'orderPayload')).toBe(true);
  });
});

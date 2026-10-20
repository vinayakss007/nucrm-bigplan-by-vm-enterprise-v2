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
 *
 * #2888 adds the fourth modal — New Invoice — which #2876 named and #2883 did not fix.
 * It is the same defect with a fourth spelling, and the reason it stayed invisible is
 * the same: this file screens the three pages it covers and nothing screened the
 * fourth. `createInvoiceSchema` requires `line_items`, the modal posted `items`, and
 * `New Invoice` has returned 400 on every install.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { orderPayload, quotePayload, subscriptionPayload, invoicePayload } from '@/lib/billing/create-payloads';
import { createOrderSchema, createQuoteSchema, createSubscriptionSchema, createInvoiceSchema } from '@/lib/api/schemas';
import { orderLineItems, orders, quoteLineItems, quotes, serviceSubscriptions, invoices, invoiceLineItems } from '@/drizzle/schema';

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
  // Same shape as `requirePerm`: synchronous, `null` meaning "no CSRF problem". Only the
  // invoices route calls it (#1835 defense-in-depth), and a mocked module without this key
  // hands the route `undefined` to call, which is a TypeError rather than a 201.
  requireCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H>(handler: H): H => handler }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

import { POST as postOrder } from '@/app/api/tenant/orders/route';
import { POST as postQuote } from '@/app/api/tenant/quotes/route';
import { POST as postSubscription } from '@/app/api/tenant/subscriptions/route';
import { POST as postInvoice } from '@/app/api/tenant/invoices/route';

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

/**
 * #2888 — the fourth modal. Copied from `app/tenant/invoices/page.tsx:57-66`: the state the
 * inputs write, including the two discount fields the invoice modal keeps separate (`discountType`
 * as a select, `discountValue` as a number) and the blank starting line item.
 */
const INVOICE_FORM = {
  title: 'Northwind retainer',
  contactId: CONTACT,
  issueDate: '2026-10-19',
  dueDate: '2026-11-18',
  notes: 'Net 30 as agreed',
  items: [
    { description: 'Monthly retainer', quantity: '2', unitPrice: '500' },
    { description: 'Overage hours', quantity: '3', unitPrice: '25' },
  ],
  discountType: 'percentage',
  discountValue: '10',
  taxRate: '5',
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

describe('POST /api/tenant/invoices with the New Invoice modal’s body (#2888)', () => {
  it('creates the invoice with the money the modal collected', async () => {
    const res = await postInvoice(request('http://localhost/api/tenant/invoices', invoicePayload(INVOICE_FORM)));
    expect(res.status).toBe(201);
    const [invoice] = into(invoices);
    // subtotal 1075, 10% off = 107.50, taxable 967.50, 5% tax = 48.38, total 1015.88
    expect(invoice?.rows).toMatchObject({
      tenantId: TENANT,
      contactId: CONTACT,
      title: 'Northwind retainer',
      status: 'draft',
      issueDate: '2026-10-19',
      dueDate: '2026-11-18',
      subtotal: '1075.00',
      discountType: 'percentage',
      discountValue: '10',
      discountAmount: '107.50',
      taxRate: '5',
      taxAmount: '48.38',
      totalAmount: '1015.88',
      balanceDue: '1015.88',
      notes: 'Net 30 as agreed',
    });
    const lines = into(invoiceLineItems);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.rows).toMatchObject({ description: 'Monthly retainer', quantity: '2', unitPrice: '500', total: '1000.00' });
    expect(lines[1]?.rows).toMatchObject({ description: 'Overage hours', quantity: '3', unitPrice: '25', total: '75.00' });
  });

  it('sends discount_type, because 10% off and 10 off are not the same invoice', async () => {
    // The route reads `discount_type` off the raw body (`route.ts:91`), outside the schema, so the
    // number alone cannot say which. A payload that dropped the key silently became a fixed amount.
    state.inserts = [];
    await postInvoice(request('http://localhost/api/tenant/invoices', invoicePayload(INVOICE_FORM)));
    const percentage = into(invoices)[0]?.rows;

    state.inserts = [];
    await postInvoice(request('http://localhost/api/tenant/invoices',
      invoicePayload({ ...INVOICE_FORM, discountType: 'fixed' })));
    const fixed = into(invoices)[0]?.rows;

    expect(percentage).toMatchObject({ discountAmount: '107.50', totalAmount: '1015.88' });
    expect(fixed).toMatchObject({ discountType: 'fixed', discountAmount: '10.00', totalAmount: '1118.25' });
  });

  it('keeps the generated title for a modal submitted with the name left blank', async () => {
    const res = await postInvoice(request('http://localhost/api/tenant/invoices', invoicePayload({
      ...INVOICE_FORM, title: '   ', contactId: '', dueDate: '', notes: '', discountValue: '0', taxRate: '0',
    })));
    expect(res.status).toBe(201);
    const [invoice] = into(invoices);
    // `title ?? \`Invoice ${invoiceNumber}\`` only fires on nullish, so an empty string would have
    // been stored as a nameless invoice — which is why the builder omits it.
    expect(invoice?.rows).toMatchObject({ title: 'Invoice INV-00008' });
    // A blank uuid input is `''`, and `uuid` accepts `''` (`schemas/common.ts:10`) — the column
    // would reject it at Postgres. `null` is what "the operator picked nothing" means.
    expect(invoice?.rows).toMatchObject({ contactId: null, dueDate: null, notes: null });
    expect(invoice?.rows).toMatchObject({ discountAmount: '0.00', taxAmount: '0.00', totalAmount: '1075.00' });
  });

  it('answers an unfilled line item with a clear 400, not a blank line on the invoice', async () => {
    const res = await postInvoice(request('http://localhost/api/tenant/invoices', invoicePayload({
      ...INVOICE_FORM, items: [{ description: '  ', quantity: '1', unitPrice: '0' }],
    })));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: Array<{ field: string }> };
    expect(body.details.map((d) => d.field)).toContain('line_items');
    expect(state.inserts, 'a rejected create must not have reached the database').toEqual([]);
  });

  it('rejects the body the page used to post — the 400 the modal has always returned', async () => {
    const res = await postInvoice(request('http://localhost/api/tenant/invoices', INVOICE_FORM));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: Array<{ field: string; message: string }> };
    expect(body.error).toBe('Validation failed');
    // Every camelCase key was stripped, so this is the only complaint left: `items` was never
    // `line_items`, and the invoice the operator typed is gone before the route looks at it.
    expect(body.details.map((d) => d.field)).toContain('line_items');
    expect(state.inserts, 'a rejected create must not have reached the database').toEqual([]);
  });
});

describe('the payload is what the schema describes (#2876)', () => {
  const pairs = [
    ['createOrderSchema', createOrderSchema, orderPayload(ORDER_FORM), []],
    ['createQuoteSchema', createQuoteSchema, quotePayload(QUOTE_FORM), []],
    ['createSubscriptionSchema', createSubscriptionSchema, subscriptionPayload(SUBSCRIPTION_FORM), []],
    // #2888: the invoice builder sends two keys its schema does not describe, on purpose, because
    // the route reads them off `rawBody` — `title` (`route.ts:90`, which is also why an empty one
    // must be omitted rather than sent) and `discount_type` (`:91`, the discount's meaning). Zod
    // would strip both from `validated.data`; the test below is what keeps that list honest.
    ['createInvoiceSchema', createInvoiceSchema, invoicePayload(INVOICE_FORM), ['title', 'discount_type']],
  ] as const;

  for (const [name, schema, payload, undeclared] of pairs) {
    it(`${name} accepts every key the builder sends`, () => {
      // Zod strips an unknown key without complaining, so a payload field the schema
      // does not describe is data that disappears with no error anywhere.
      const accepted = new Set(Object.keys(schema.shape));
      const unaccepted = Object.keys(payload).filter((key) => !accepted.has(key) && !undeclared.includes(key));
      expect(unaccepted, `${name} would strip ${unaccepted.join(', ')}`).toEqual([]);
    });
  }

  it('allows an undeclared key only where the route actually reads it off the raw body', () => {
    // Without this, the exemption list above is a place to hide a field that goes nowhere: the
    // schema stays silent about it, and so does the server.
    const route = readFileSync('app/api/tenant/invoices/route.ts', 'utf8');
    const accepted = new Set(Object.keys(createInvoiceSchema.shape));
    for (const key of Object.keys(invoicePayload(INVOICE_FORM))) {
      if (accepted.has(key)) continue;
      expect(route, `${key} is sent but never read off rawBody`).toContain(`rawBody.${key}`);
    }
  });

  /** A modal is only covered while it builds its body out of the shared module. */
  const buildsBody = (src: string, builder: string) =>
    src.includes(`import { ${builder} } from '@/lib/billing/create-payloads'`)
    && src.includes(`body: JSON.stringify(${builder}(form))`);

  it('every modal builds its body out of lib/billing/create-payloads', () => {
    const modals: Array<[path: string, builder: string]> = [
      ['app/tenant/orders/page.tsx', 'orderPayload'],
      ['app/tenant/quotes/page.tsx', 'quotePayload'],
      ['app/tenant/subscriptions/page.tsx', 'subscriptionPayload'],
      ['app/tenant/invoices/page.tsx', 'invoicePayload'],
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

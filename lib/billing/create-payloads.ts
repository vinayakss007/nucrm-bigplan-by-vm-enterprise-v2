/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2876 — the three create forms collected camelCase and their routes validated
 * snake_case, so all three have been rejected on every install since they were wired:
 * `createOrderSchema` / `createQuoteSchema` require `line_items` with `unit_price`
 * while the pages posted `items` with `unitPrice`, and Zod's object parse strips
 * unknown keys rather than rejecting them, so the request arrives at the route with
 * the operator's data already gone. `POST /api/tenant/subscriptions` then 400'd on its
 * own `if (!startDate)` guard because `startDate` had been stripped along with
 * everything else the form collected.
 *
 * Nothing caught it because the write path was only ever tested with snake_case
 * payloads written from the schemas, and `tests/unit/orders-atomic-number-2342.test.ts`
 * stubs `validateBody` to pass its input straight through — so the page side and the
 * schema side were never in the same room.
 *
 * The three payload builders below are the one place that knows both halves. The pages
 * call them, `tests/unit/create-form-body-2876.test.ts` posts their output through the
 * real routes with the real schemas, and a screen in that file fails if a page goes
 * back to stringifying its form directly.
 */

/** What the Create Order / Quote / Subscription modals keep in `useState`. */
interface LineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface OrderDraft {
  title: string;
  contactId: string;
  /** `new Date().toISOString().split('T')[0]` — the modal's default, so possibly undefined. */
  orderDate?: string;
  expectedDeliveryDate: string;
  notes: string;
  items: LineItemDraft[];
}

interface QuoteDraft {
  title: string;
  contactId: string;
  dealId: string;
  expiresAt: string;
  notes: string;
  terms: string;
  discount: string;
  tax: string;
  items: LineItemDraft[];
}

interface SubscriptionDraft {
  name: string;
  planName: string;
  startDate?: string;
  currentPeriodEnd: string;
  amount: string;
  billingFrequency: string;
  autoRenew: boolean;
  paymentMethod: string;
  last4: string;
}

/**
 * A blank text input is `''`, and the uuid columns reject `''` at Postgres rather than
 * treating it as "not specified" — `null` is what "the operator picked nothing" means.
 */
const blankToNull = (value: string | undefined): string | null => value?.trim() || null;

/** `parseFloat` with the same `|| fallback` the modals' own subtotal math already uses. */
const num = (value: string, fallback: number): number => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * An empty line is the modal's starting row, not a line the operator entered — the
 * route requires `min(1)`, so dropping them is what makes "Add another item" without
 * filling it in a validation error instead of a silent second blank row.
 */
const lineItems = (items: LineItemDraft[]) =>
  items
    .filter((item) => item.description.trim())
    .map((item) => ({
      description: item.description.trim(),
      quantity: num(item.quantity, 1),
      unit_price: num(item.unitPrice, 0),
    }));

export function orderPayload(form: OrderDraft) {
  return {
    title: form.title.trim(),
    contact_id: blankToNull(form.contactId),
    order_date: blankToNull(form.orderDate),
    expected_delivery_date: blankToNull(form.expectedDeliveryDate),
    notes: blankToNull(form.notes),
    line_items: lineItems(form.items),
    // `subtotal` is not sent: the route recomputes it from line_items, and a client-side
    // total that disagreed with the server's would be silently discarded anyway.
  };
}

export function quotePayload(form: QuoteDraft) {
  return {
    title: form.title.trim(),
    contact_id: blankToNull(form.contactId),
    expiry_date: blankToNull(form.expiresAt),
    notes: blankToNull(form.notes),
    terms: blankToNull(form.terms),
    discount: num(form.discount, 0),
    tax: num(form.tax, 0),
    line_items: lineItems(form.items),
    // `dealId` is in the modal's state but no input writes it and `createQuoteSchema`
    // has no `deal_id`, so sending it would just be the same dead key in a new place.
  };
}

export function subscriptionPayload(form: SubscriptionDraft) {
  return {
    name: form.name.trim(),
    plan_name: blankToNull(form.planName),
    start_date: blankToNull(form.startDate),
    end_date: blankToNull(form.currentPeriodEnd),
    amount: num(form.amount, 0),
    billing_frequency: form.billingFrequency,
    auto_renew: form.autoRenew,
    // `paymentMethod` / `last4` are in the modal's state with no input that renders
    // them, so they are always '' — and the schema has no place for a value nobody collects.
  };
}

export type { OrderDraft, QuoteDraft, SubscriptionDraft, LineItemDraft };

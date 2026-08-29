/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Typed Stripe event-fixture builders for the #1477 billing-lifecycle harness.
 *
 * Each builder returns the `{ id, type, data: { object }, created }` envelope
 * shape consumed by app/api/webhooks/stripe/route.ts, populating exactly the
 * fields the handlers read (metadata.tenant_id, customer, subscription,
 * status, cancel_at_period_end, items.data[0].price.id, amount_paid, id).
 *
 * Every fixture gets a stable-but-unique `id` (`evt_<hex>`) so idempotency can
 * be exercised deterministically. Dependency-free and pure.
 */

import { randomBytes } from 'crypto';

/**
 * Envelope shape the webhook handler consumes. The `object` payload varies per
 * event type, so it stays loosely keyed but never `any`.
 */
export interface StripeEventEnvelope {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

function eventId(): string {
  return `evt_${randomBytes(12).toString('hex')}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Build a `checkout.session.completed` event. */
export function buildCheckoutSessionCompleted(params: {
  tenantId: string;
  customerId: string;
  subscriptionId: string;
  priceId?: string;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: `cs_${randomBytes(10).toString('hex')}`,
    object: 'checkout.session',
    customer: params.customerId,
    subscription: params.subscriptionId,
    metadata: { tenant_id: params.tenantId },
  };
  if (params.priceId) {
    object['line_items'] = { data: [{ price: { id: params.priceId } }] };
  }
  return {
    id: eventId(),
    type: 'checkout.session.completed',
    created: nowSeconds(),
    data: { object },
  };
}

/** Build a `customer.subscription.updated` event. */
export function buildSubscriptionUpdated(params: {
  tenantId: string;
  status: string;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: `sub_${randomBytes(10).toString('hex')}`,
    object: 'subscription',
    status: params.status,
    cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
    metadata: { tenant_id: params.tenantId },
    items: { data: [{ price: { id: params.priceId ?? '' } }] },
  };
  return {
    id: eventId(),
    type: 'customer.subscription.updated',
    created: nowSeconds(),
    data: { object },
  };
}

/**
 * Build a `customer.subscription.updated` event WITHOUT `metadata.tenant_id`.
 *
 * Real Stripe-originated `subscription.*` events do not necessarily carry the
 * `tenant_id` we set at checkout time. The handler resolves the tenant solely
 * via `metadata.tenant_id` and safely drops the event (early return) when it is
 * absent. This negative fixture pins that documented drop-on-missing-metadata
 * behavior: relaying it must leave tenant state UNCHANGED.
 */
export function buildSubscriptionUpdatedNoTenant(params: {
  status: string;
  priceId?: string;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: `sub_${randomBytes(10).toString('hex')}`,
    object: 'subscription',
    status: params.status,
    cancel_at_period_end: false,
    // Intentionally NO metadata.tenant_id — handler must ignore this event.
    items: { data: [{ price: { id: params.priceId ?? '' } }] },
  };
  return {
    id: eventId(),
    type: 'customer.subscription.updated',
    created: nowSeconds(),
    data: { object },
  };
}

/** Build a `customer.subscription.deleted` event. */
export function buildSubscriptionDeleted(params: {
  tenantId: string;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: `sub_${randomBytes(10).toString('hex')}`,
    object: 'subscription',
    metadata: { tenant_id: params.tenantId },
  };
  return {
    id: eventId(),
    type: 'customer.subscription.deleted',
    created: nowSeconds(),
    data: { object },
  };
}

/** Build an `invoice.payment_succeeded` event. */
export function buildInvoicePaymentSucceeded(params: {
  customerId: string;
  invoiceId: string;
  amountPaid: number;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: params.invoiceId,
    object: 'invoice',
    customer: params.customerId,
    amount_paid: params.amountPaid,
  };
  return {
    id: eventId(),
    type: 'invoice.payment_succeeded',
    created: nowSeconds(),
    data: { object },
  };
}

/** Build an `invoice.payment_failed` event. */
export function buildInvoicePaymentFailed(params: {
  customerId: string;
  invoiceId: string;
  amountPaid?: number;
}): StripeEventEnvelope {
  const object: Record<string, unknown> = {
    id: params.invoiceId,
    object: 'invoice',
    customer: params.customerId,
    amount_paid: params.amountPaid ?? 0,
  };
  return {
    id: eventId(),
    type: 'invoice.payment_failed',
    created: nowSeconds(),
    data: { object },
  };
}

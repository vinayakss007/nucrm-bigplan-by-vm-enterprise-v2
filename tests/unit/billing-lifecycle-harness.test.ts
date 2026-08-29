/**
 * Billing-lifecycle harness unit tests (#1477).
 *
 * Verifies the pure helpers under scripts/billing-harness/ WITHOUT live keys:
 *  - signStripeWebhook round-trips through lib/stripe.ts verifyWebhookSignature
 *    (proves the signer matches the verifier; fails if the scheme drifts).
 *  - verifyWebhookSignature REJECTS a wrong-secret signature and a tampered body.
 *  - Each fixture builder emits the exact envelope fields the handler reads.
 *  - The assert utilities behave (pass/fail, summarize counts, redact masking).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockStripeEnv, clearStripeEnv } from '../helpers/stripe-mock';
import { signStripeWebhook } from '@/scripts/billing-harness/webhook-sign';
import {
  buildCheckoutSessionCompleted,
  buildSubscriptionUpdated,
  buildSubscriptionUpdatedNoTenant,
  buildSubscriptionDeleted,
  buildInvoicePaymentSucceeded,
  buildInvoicePaymentFailed,
} from '@/scripts/billing-harness/fixtures';
import {
  assertEqual,
  assertOneOf,
  assertTrue,
  formatCheck,
  summarize,
  redact,
} from '@/scripts/billing-harness/assert';

const WEBHOOK_SECRET = 'whsec_mock_secret_456';

describe('billing-harness/webhook-sign + lib/stripe verifier round-trip', () => {
  beforeEach(() => {
    mockStripeEnv();
    vi.resetModules();
  });

  afterEach(() => {
    clearStripeEnv();
  });

  it('produces a signature accepted by verifyWebhookSignature', async () => {
    const { verifyWebhookSignature } = await import('@/lib/stripe');
    const event = buildCheckoutSessionCompleted({
      tenantId: 'tenant-abc',
      customerId: 'cus_test123',
      subscriptionId: 'sub_test123',
      priceId: 'price_starter_monthly',
    });
    const body = JSON.stringify(event);
    const signature = signStripeWebhook(body, WEBHOOK_SECRET);

    const parsed = await verifyWebhookSignature(body, signature);
    expect(parsed.id).toBe(event.id);
    expect(parsed.type).toBe('checkout.session.completed');
    expect((parsed.data.object as { metadata: { tenant_id: string } }).metadata.tenant_id).toBe('tenant-abc');
  });

  it('rejects a signature produced with the WRONG secret', async () => {
    const { verifyWebhookSignature } = await import('@/lib/stripe');
    const event = buildInvoicePaymentSucceeded({
      customerId: 'cus_test123',
      invoiceId: 'in_test123',
      amountPaid: 2900,
    });
    const body = JSON.stringify(event);
    const badSignature = signStripeWebhook(body, 'whsec_the_wrong_secret_000');

    await expect(verifyWebhookSignature(body, badSignature)).rejects.toThrow(
      'Webhook signature verification failed',
    );
  });

  it('rejects a body mutated after signing (tampering)', async () => {
    const { verifyWebhookSignature } = await import('@/lib/stripe');
    const event = buildSubscriptionUpdated({
      tenantId: 'tenant-abc',
      status: 'active',
      priceId: 'price_pro_monthly',
    });
    const body = JSON.stringify(event);
    const signature = signStripeWebhook(body, WEBHOOK_SECRET);

    // Mutate the body AFTER signing — signature must no longer match.
    const tamperedBody = body.replace('tenant-abc', 'tenant-evil');
    expect(tamperedBody).not.toBe(body);

    await expect(verifyWebhookSignature(tamperedBody, signature)).rejects.toThrow(
      'Webhook signature verification failed',
    );
  });

  it('signs + verifies the no-tenant negative fixture (handler, not verifier, drops it)', async () => {
    // The signer/verifier contract is agnostic to metadata; the DROP happens in
    // the webhook handler (missing metadata.tenant_id ⇒ early return), not in the
    // verifier. This proves the negative fixture round-trips like any other event.
    const { verifyWebhookSignature } = await import('@/lib/stripe');
    const event = buildSubscriptionUpdatedNoTenant({ status: 'active' });
    const body = JSON.stringify(event);
    const signature = signStripeWebhook(body, WEBHOOK_SECRET);
    const parsed = await verifyWebhookSignature(body, signature);
    expect(parsed.type).toBe('customer.subscription.updated');
    expect((parsed.data.object as { metadata?: unknown }).metadata).toBeUndefined();
  });

  it('honours an explicit timestamp in the header', async () => {
    const { verifyWebhookSignature } = await import('@/lib/stripe');
    const ts = Math.floor(Date.now() / 1000) - 60; // still within 300s tolerance
    const event = buildInvoicePaymentFailed({ customerId: 'cus_x', invoiceId: 'in_x' });
    const body = JSON.stringify(event);
    const signature = signStripeWebhook(body, WEBHOOK_SECRET, ts);

    expect(signature.startsWith(`t=${ts},v1=`)).toBe(true);
    const parsed = await verifyWebhookSignature(body, signature);
    expect(parsed.type).toBe('invoice.payment_failed');
  });
});

describe('billing-harness/fixtures', () => {
  it('checkout.session.completed carries the fields the handler reads', () => {
    const event = buildCheckoutSessionCompleted({
      tenantId: 't1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      priceId: 'price_starter_monthly',
    });
    expect(event.type).toBe('checkout.session.completed');
    expect(event.id.startsWith('evt_')).toBe(true);
    const obj = event.data.object as {
      metadata: { tenant_id: string };
      customer: string;
      subscription: string;
      line_items: { data: Array<{ price: { id: string } }> };
    };
    expect(obj.metadata.tenant_id).toBe('t1');
    expect(obj.customer).toBe('cus_1');
    expect(obj.subscription).toBe('sub_1');
    expect(obj.line_items.data[0]!.price.id).toBe('price_starter_monthly');
  });

  it('customer.subscription.updated carries status, cancel flag and price id', () => {
    const event = buildSubscriptionUpdated({
      tenantId: 't2',
      status: 'past_due',
      priceId: 'price_pro_monthly',
      cancelAtPeriodEnd: true,
    });
    expect(event.type).toBe('customer.subscription.updated');
    const obj = event.data.object as {
      metadata: { tenant_id: string };
      status: string;
      cancel_at_period_end: boolean;
      items: { data: Array<{ price: { id: string } }> };
    };
    expect(obj.metadata.tenant_id).toBe('t2');
    expect(obj.status).toBe('past_due');
    expect(obj.cancel_at_period_end).toBe(true);
    expect(obj.items.data[0]!.price.id).toBe('price_pro_monthly');
  });

  it('subscription.updated (no-tenant variant) omits metadata.tenant_id but keeps the shape', () => {
    const event = buildSubscriptionUpdatedNoTenant({ status: 'canceled', priceId: 'price_pro_monthly' });
    expect(event.type).toBe('customer.subscription.updated');
    expect(event.id.startsWith('evt_')).toBe(true);
    const obj = event.data.object as {
      metadata?: { tenant_id?: string };
      status: string;
      cancel_at_period_end: boolean;
      items: { data: Array<{ price: { id: string } }> };
    };
    // The whole point of the negative fixture: NO tenant_id anywhere.
    expect(obj.metadata).toBeUndefined();
    expect(obj.status).toBe('canceled');
    expect(obj.cancel_at_period_end).toBe(false);
    expect(obj.items.data[0]!.price.id).toBe('price_pro_monthly');
  });

  it('customer.subscription.deleted carries tenant metadata', () => {
    const event = buildSubscriptionDeleted({ tenantId: 't3' });
    expect(event.type).toBe('customer.subscription.deleted');
    const obj = event.data.object as { metadata: { tenant_id: string } };
    expect(obj.metadata.tenant_id).toBe('t3');
  });

  it('invoice.payment_succeeded carries customer, id and amount_paid', () => {
    const event = buildInvoicePaymentSucceeded({
      customerId: 'cus_9',
      invoiceId: 'in_9',
      amountPaid: 7900,
    });
    expect(event.type).toBe('invoice.payment_succeeded');
    const obj = event.data.object as { customer: string; id: string; amount_paid: number };
    expect(obj.customer).toBe('cus_9');
    expect(obj.id).toBe('in_9');
    expect(obj.amount_paid).toBe(7900);
  });

  it('invoice.payment_failed carries customer and id', () => {
    const event = buildInvoicePaymentFailed({ customerId: 'cus_10', invoiceId: 'in_10' });
    expect(event.type).toBe('invoice.payment_failed');
    const obj = event.data.object as { customer: string; id: string; amount_paid: number };
    expect(obj.customer).toBe('cus_10');
    expect(obj.id).toBe('in_10');
    expect(obj.amount_paid).toBe(0);
  });

  it('gives each event a unique id so idempotency can be exercised', () => {
    const a = buildSubscriptionDeleted({ tenantId: 't' });
    const b = buildSubscriptionDeleted({ tenantId: 't' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('billing-harness/assert', () => {
  it('assertEqual passes on equal values and fails otherwise', () => {
    expect(assertEqual('eq', 'active', 'active').pass).toBe(true);
    const failed = assertEqual('eq', 'past_due', 'active');
    expect(failed.pass).toBe(false);
    expect(failed.detail).toContain('expected');
  });

  it('assertEqual compares objects structurally', () => {
    expect(assertEqual('obj', { a: 1, b: 2 }, { a: 1, b: 2 }).pass).toBe(true);
  });

  it('assertOneOf passes when actual is in the allowed set', () => {
    expect(assertOneOf('status', 'active', ['active', 'trialing']).pass).toBe(true);
    expect(assertOneOf('status', 'deleted', ['active', 'trialing']).pass).toBe(false);
  });

  it('assertTrue reflects the condition', () => {
    expect(assertTrue('t', true).pass).toBe(true);
    expect(assertTrue('t', false, 'nope').detail).toBe('nope');
  });

  it('formatCheck renders PASS/FAIL lines', () => {
    expect(formatCheck({ name: 'x', pass: true })).toBe('[PASS] x');
    expect(formatCheck({ name: 'y', pass: false, detail: 'boom' })).toBe('[FAIL] y — boom');
  });

  it('summarize counts passed and failed', () => {
    const result = summarize([
      { name: 'a', pass: true },
      { name: 'b', pass: false },
      { name: 'c', pass: true },
    ]);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.allPassed).toBe(false);
  });

  it('summarize reports allPassed when nothing failed', () => {
    expect(summarize([{ name: 'a', pass: true }]).allPassed).toBe(true);
  });

  it('redact masks all but the last 4 characters', () => {
    expect(redact('sk_test_abcd1234')).toBe('************1234');
    expect(redact('abcd')).toBe('****');
    expect(redact('ab')).toBe('**');
  });
});

/**
 * #1640: Stripe subscription webhook tenant-resolution fallback.
 *
 * `customer.subscription.updated` / `.deleted` used to require
 * `metadata.tenant_id` and silently `return` when it was absent. Stripe does
 * not echo that metadata onto every subscription event, so genuine status
 * transitions and cancellations were being dropped — a revenue/entitlement
 * integrity bug.
 *
 * These tests drive the exported POST handler (the handlers themselves are not
 * exported) and assert three behaviours for BOTH event types:
 *   (a) metadata.tenant_id present            -> resolves and applies
 *   (b) no metadata, customer maps to a tenant -> resolves via customer and applies
 *   (c) no metadata, customer is unmappable    -> no-op (no throw, no write)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB: record update().set() payloads and control the tenant lookup. ──
const m = vi.hoisted(() => {
  const updateSet = vi.fn();
  const whereAfterUpdate = vi.fn();
  // Tenant returned by db.query.tenants.findFirst for the *customer-id* lookup.
  let customerLookupTenant: { id: string } | null = null;
  // Tenant returned for the terminal-status guard lookup in updated().
  let statusLookupTenant: { status: string } | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: (pred: unknown) => { whereAfterUpdate(pred); return Promise.resolve({ rowCount: 1 }); } };
      },
    })),
    query: {
      tenants: {
        findFirst: vi.fn((args: { columns?: Record<string, boolean> }) => {
          // The terminal-status guard asks for { status: true }; the
          // customer-id fallback asks for { id: true }.
          if (args?.columns?.status) return Promise.resolve(statusLookupTenant);
          return Promise.resolve(customerLookupTenant);
        }),
      },
    },
  };

  return {
    db,
    updateSet,
    whereAfterUpdate,
    setCustomerLookupTenant: (t: { id: string } | null) => { customerLookupTenant = t; },
    setStatusLookupTenant: (t: { status: string } | null) => { statusLookupTenant = t; },
  };
});

// verifyWebhookSignature just echoes the parsed body as the event.
const verifyWebhookSignature = vi.fn(async (body: string) => JSON.parse(body));

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  tenants: {
    id: 'tenants.id',
    stripeCustomerId: 'tenants.stripe_customer_id',
    status: 'tenants.status',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  verifyWebhookSignature: (...args: unknown[]) => verifyWebhookSignature(args[0] as string),
  StripeError: class StripeError extends Error {},
}));
vi.mock('@/lib/cache/index', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true })),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (_e: unknown, msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

import { POST } from '@/app/api/webhooks/stripe/route';

const CUSTOMER = 'cus_mapped_123';
const RESOLVED_TENANT = 'tenant-from-customer';
const METADATA_TENANT = 'tenant-from-metadata';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequest(event: any): any {
  const body = JSON.stringify(event);
  return {
    headers: { get: (h: string) => (h === 'stripe-signature' ? 't=1,v1=sig' : null) },
    text: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updatedEvent(over: Record<string, any> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.updated',
    data: { object: { status: 'active', items: { data: [] }, ...over } },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deletedEvent(over: Record<string, any> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.deleted',
    data: { object: { status: 'canceled', items: { data: [] }, ...over } },
  };
}

/** id in the where predicate of the update() call, if any. */
function lastUpdateTargetId(): unknown {
  const pred = m.whereAfterUpdate.mock.calls.at(-1)?.[0] as { eq?: unknown[] } | undefined;
  return pred?.eq?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  m.setCustomerLookupTenant(null);
  m.setStatusLookupTenant(null);
});

describe('#1640 subscription.updated tenant resolution', () => {
  it('(a) resolves via metadata.tenant_id and applies the update', async () => {
    const res = await POST(makeRequest(updatedEvent({ metadata: { tenant_id: METADATA_TENANT } })));

    expect(res.status).toBe(200);
    // No customer lookup needed — the metadata fast-path short-circuits.
    expect(lastUpdateTargetId()).toBe(METADATA_TENANT);
  });

  it('(b) falls back to the customer id when metadata is absent', async () => {
    m.setCustomerLookupTenant({ id: RESOLVED_TENANT });

    const res = await POST(makeRequest(updatedEvent({ customer: CUSTOMER })));

    expect(res.status).toBe(200);
    // The lookup ran with the event's customer id...
    expect(m.db.query.tenants.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eq: ['tenants.stripe_customer_id', CUSTOMER] } })
    );
    // ...and the resolved tenant received the status update.
    expect(lastUpdateTargetId()).toBe(RESOLVED_TENANT);
  });

  it('(b) unwraps an expanded customer object to its id', async () => {
    m.setCustomerLookupTenant({ id: RESOLVED_TENANT });

    const res = await POST(makeRequest(updatedEvent({ customer: { id: CUSTOMER, object: 'customer' } })));

    expect(res.status).toBe(200);
    expect(m.db.query.tenants.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eq: ['tenants.stripe_customer_id', CUSTOMER] } })
    );
    expect(lastUpdateTargetId()).toBe(RESOLVED_TENANT);
  });

  it('(c) no metadata + unmappable customer is a no-op (no throw, no write)', async () => {
    m.setCustomerLookupTenant(null); // customer maps to nothing

    const res = await POST(makeRequest(updatedEvent({ customer: 'cus_nonexistent_999' })));

    expect(res.status).toBe(200);
    expect(m.db.update).not.toHaveBeenCalled();
  });
});

describe('#1640 subscription.deleted tenant resolution', () => {
  it('(a) resolves via metadata.tenant_id and downgrades to free', async () => {
    const res = await POST(makeRequest(deletedEvent({ metadata: { tenant_id: METADATA_TENANT } })));

    expect(res.status).toBe(200);
    expect(lastUpdateTargetId()).toBe(METADATA_TENANT);
    expect(m.updateSet).toHaveBeenCalledWith(expect.objectContaining({ planId: 'free', stripeSubscriptionId: null }));
  });

  it('(b) falls back to the customer id when metadata is absent', async () => {
    m.setCustomerLookupTenant({ id: RESOLVED_TENANT });

    const res = await POST(makeRequest(deletedEvent({ customer: CUSTOMER })));

    expect(res.status).toBe(200);
    expect(m.db.query.tenants.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eq: ['tenants.stripe_customer_id', CUSTOMER] } })
    );
    expect(lastUpdateTargetId()).toBe(RESOLVED_TENANT);
    expect(m.updateSet).toHaveBeenCalledWith(expect.objectContaining({ planId: 'free', stripeSubscriptionId: null }));
  });

  it('(c) no metadata + unmappable customer is a no-op (no throw, no write)', async () => {
    m.setCustomerLookupTenant(null);

    const res = await POST(makeRequest(deletedEvent({ customer: 'cus_nonexistent_999' })));

    expect(res.status).toBe(200);
    expect(m.db.update).not.toHaveBeenCalled();
  });
});

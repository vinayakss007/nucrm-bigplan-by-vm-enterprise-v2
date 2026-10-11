/*!
 * #2551 — billing_events.currency must never be a guess.
 *
 * `billing_events` is the money ledger, and five write sites stamped
 * `currency: 'usd'` into it. There is no currency column on `plans` or on
 * `subscriptions` — the only place a currency actually exists is the response
 * the PSP hands back — so those five inserts asserted a fact the process had
 * never learned. The column default (`'usd'::text`) guesses the same way when
 * the field is omitted, which is why `lib/billing-currency.ts` requires every
 * caller to pass the value explicitly, NULL included.
 *
 * The honest value is NULL when nobody answered (the marker rows written
 * before the Stripe call, and the scheduled downgrade, which never talks to
 * the PSP at all) and the provider's own code after it did.
 *
 * The read side had the same invention in mirror image:
 * `app/api/tenant/billing/invoices/route.ts` prefixed every amount with `$`
 * and coalesced a NULL currency to 'usd' on the way out, so the UI could only
 * ever render dollars. It now ships raw numbers and lets the page decide —
 * with a symbol only when a real code exists.
 *
 * Uses the thenable-db mock pattern from tests/unit/billing/upgrade-idempotency.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";

const TENANT = "a1111111-1111-4111-8111-111111111111";
const SUB_ID = "b2222222-2222-4222-8222-222222222222";
const STRIPE_SUB = "sub_1234567890";

const m = vi.hoisted(() => {
  const state = {
    markers: [] as Array<Record<string, unknown>>,
    txEventInserts: [] as Array<Record<string, unknown>>,
    /** Row set returned by db.query.subscriptions.findFirst. */
    subscription: null as Record<string, unknown> | null,
    /** Rows returned by the invoices GET select. */
    invoiceRows: [] as Array<Record<string, unknown>>,
  };

  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.txEventInserts.push(values);
      }),
    })),
  };

  const db = {
    query: {
      subscriptions: {
        findFirst: vi.fn(async () => state.subscription),
      },
      plans: {
        findFirst: vi.fn(async (_args?: unknown) => undefined as unknown),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.markers.push(values);
      }),
    })),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(state.invoiceRows),
          }),
        }),
      }),
    })),
  };

  return { state, db, tx };
});

vi.mock("@/drizzle/db", () => ({ db: m.db }));
vi.mock("@/drizzle/schema", () => ({
  subscriptions: {
    id: "subscriptions.id",
    tenantId: "subscriptions.tenant_id",
  },
  plans: { id: "plans.id" },
  billingEvents: {
    id: "billing_events.id",
    tenantId: "billing_events.tenant_id",
    eventType: "billing_events.event_type",
    amount: "billing_events.amount",
    currency: "billing_events.currency",
    stripeInvoiceId: "billing_events.stripe_invoice_id",
    stripeSubscriptionId: "billing_events.stripe_subscription_id",
    metadata: "billing_events.metadata",
    createdAt: "billing_events.created_at",
    deletedAt: "billing_events.deleted_at",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
}));
vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: "admin-1",
    isAdmin: true,
  })),
  requireCsrf: vi.fn(() => null),
}));
vi.mock("@/lib/api/with-api-route", () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock("@/lib/api/mutating-rate-limit", () => ({
  rateLimitMutating: vi.fn(async () => null),
}));
vi.mock("@/lib/api/validate", async () => {
  const { NextResponse } = await import("next/server");
  return {
    readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) =>
      req.json(),
    ),
    validateBody: vi.fn(
      (
        schema: {
          safeParse: (d: unknown) => { success: boolean; data?: unknown };
        },
        data: unknown,
      ) => {
        const r = schema.safeParse(data);
        return r.success
          ? { data: r.data }
          : NextResponse.json({ error: "invalid body" }, { status: 400 });
      },
    ),
  };
});
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: vi.fn(() => true),
  getPriceId: vi.fn(() => "price_pro_monthly"),
  updateSubscription: vi.fn(async () => ({ id: STRIPE_SUB, status: "active" })),
  cancelSubscription: vi.fn(async () => ({
    id: STRIPE_SUB,
    status: "canceled",
  })),
  resumeSubscription: vi.fn(async () => ({
    id: STRIPE_SUB,
    status: "active",
    current_period_end: 1761955200,
  })),
  scheduleDowngradeAtPeriodEnd: vi.fn(async () => ({
    scheduleId: "sub_sched_1",
    effectiveAt: 1761955200,
  })),
  getSubscription: vi.fn(async () => ({ id: STRIPE_SUB })),
  getSubscriptionPeriodStart: vi.fn(() => 1759276800),
  getSubscriptionPeriodEnd: vi.fn(() => 1761955200),
}));
vi.mock("@/lib/errors-server", () => ({
  logError: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api-error", async () => {
  const { NextResponse } = await import("next/server");
  return {
    apiError: vi.fn((err: unknown) =>
      NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      ),
    ),
  };
});

import {
  cancelSubscription,
  resumeSubscription,
  updateSubscription,
} from "@/lib/stripe";
import {
  currencyFromProvider,
  isRenderableCurrencyCode,
} from "@/lib/billing-currency";
import { POST as cancelPOST } from "@/app/api/tenant/billing/subscription/cancel/route";
import { POST as resumePOST } from "@/app/api/tenant/billing/subscription/resume/route";
import { POST as downgradePOST } from "@/app/api/tenant/billing/subscription/downgrade/route";
import { POST as upgradePOST } from "@/app/api/tenant/billing/subscription/upgrade/route";
import { GET as invoicesGET } from "@/app/api/tenant/billing/invoices/route";

const POST_ROUTES = {
  cancel: cancelPOST,
  resume: resumePOST,
  downgrade: downgradePOST,
  upgrade: upgradePOST,
};

function jsonRequest(
  path: string,
  body: Record<string, unknown> = {},
): NextRequest {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function subscriptionRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUB_ID,
    tenantId: TENANT,
    planId: "starter",
    status: "active",
    stripeSubscriptionId: STRIPE_SUB,
    currentPeriodStart: new Date("2026-09-01"),
    currentPeriodEnd: new Date("2026-10-01"),
    cancelAtPeriodEnd: false,
    metadata: {},
    ...over,
  };
}

const PLANS: Record<
  string,
  { id: string; name: string; priceMonthly: string }
> = {
  pro: { id: "pro", name: "Pro", priceMonthly: "50.00" },
  starter: { id: "starter", name: "Starter", priceMonthly: "20.00" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.state.markers = [];
  m.state.txEventInserts = [];
  m.state.invoiceRows = [];
  m.state.subscription = subscriptionRow();
  m.db.query.plans.findFirst.mockImplementation(
    async (args?: { where?: { eq?: [unknown, unknown] } }) => {
      const pid = String(args?.where?.eq?.[1] ?? "");
      return PLANS[pid] ?? null;
    },
  );
});

describe("currencyFromProvider / isRenderableCurrencyCode", () => {
  it("normalises a provider code and trims it", () => {
    expect(currencyFromProvider({ currency: "EUR" })).toBe("eur");
    expect(currencyFromProvider({ currency: "  usd " })).toBe("usd");
  });

  it("returns null for anything that is not a currency", () => {
    expect(currencyFromProvider(undefined)).toBeNull();
    expect(currencyFromProvider(null)).toBeNull();
    expect(currencyFromProvider({})).toBeNull();
    expect(currencyFromProvider({ currency: "" })).toBeNull();
    expect(currencyFromProvider({ currency: "   " })).toBeNull();
    expect(currencyFromProvider({ currency: 3 })).toBeNull();
  });

  it("accepts only a three-letter code for rendering", () => {
    expect(isRenderableCurrencyCode("usd")).toBe(true);
    expect(isRenderableCurrencyCode("INR")).toBe(true);
    expect(isRenderableCurrencyCode("us")).toBe(false);
    expect(isRenderableCurrencyCode("usdx")).toBe(false);
    expect(isRenderableCurrencyCode("u1d")).toBe(false);
    expect(isRenderableCurrencyCode(null)).toBe(false);
    expect(isRenderableCurrencyCode(undefined)).toBe(false);
  });
});

describe("billing writes carry the provider currency, never a guessed one", () => {
  it("cancel records the currency Stripe returned", async () => {
    vi.mocked(cancelSubscription).mockResolvedValueOnce({
      currency: "eur",
    } as never);

    const res = await POST_ROUTES.cancel(
      jsonRequest("/api/tenant/billing/subscription/cancel", {}),
    );
    expect(res.status).toBe(200);
    expect(m.state.txEventInserts[0]).toMatchObject({
      eventType: "subscription.cancel_scheduled",
      currency: "eur",
    });
  });

  it("cancel records NULL when Stripe answers with no currency", async () => {
    const res = await POST_ROUTES.cancel(
      jsonRequest("/api/tenant/billing/subscription/cancel", {}),
    );
    expect(res.status).toBe(200);
    expect(m.state.txEventInserts[0]!.currency).toBeNull();
  });

  it("resume records the currency Stripe returned", async () => {
    m.state.subscription = subscriptionRow({ cancelAtPeriodEnd: true });
    vi.mocked(resumeSubscription).mockResolvedValueOnce({
      currency: "GBP",
      current_period_end: 1761955200,
    } as never);

    const res = await POST_ROUTES.resume(
      jsonRequest("/api/tenant/billing/subscription/resume"),
    );
    expect(res.status).toBe(200);
    expect(m.state.txEventInserts[0]).toMatchObject({
      eventType: "subscription.resumed",
      currency: "gbp",
    });
  });

  it("a scheduled downgrade records NULL — the PSP is never contacted", async () => {
    m.state.subscription = subscriptionRow({ planId: "pro" });
    const res = await POST_ROUTES.downgrade(
      jsonRequest("/api/tenant/billing/subscription/downgrade", {
        planId: "starter",
      }),
    );
    expect(res.status).toBe(200);
    expect(m.state.txEventInserts[0]).toMatchObject({
      eventType: "subscription.downgrade_scheduled",
      currency: null,
    });
  });

  it("upgrade: markers before the Stripe call are NULL, the row after it is not", async () => {
    vi.mocked(updateSubscription).mockImplementationOnce(
      async () =>
        ({ id: STRIPE_SUB, status: "active", currency: "inr" }) as never,
    );

    const res = await POST_ROUTES.upgrade(
      jsonRequest("/api/tenant/billing/subscription/upgrade", {
        planId: "pro",
        interval: "month",
      }),
    );
    expect(res.status).toBe(200);

    const attempted = m.state.markers.filter(
      (x) => x.eventType === "subscription.upgrade_attempted",
    );
    expect(attempted).toHaveLength(1);
    expect(attempted[0]!.currency).toBeNull();

    expect(m.state.txEventInserts[0]).toMatchObject({
      eventType: "subscription.upgraded",
      currency: "inr",
    });
  });

  it("upgrade: a Stripe rejection marks the attempt failed with NULL currency", async () => {
    vi.mocked(updateSubscription).mockRejectedValueOnce(
      new Error("card_declined"),
    );

    const res = await POST_ROUTES.upgrade(
      jsonRequest("/api/tenant/billing/subscription/upgrade", {
        planId: "pro",
        interval: "month",
      }),
    );
    expect(res.status).toBe(500);

    const failed = m.state.markers.filter(
      (x) => x.eventType === "subscription.upgrade_failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.currency).toBeNull();
    expect(m.state.txEventInserts).toHaveLength(0);
  });

  it("upgrade: the desync marker carries the currency Stripe already charged in", async () => {
    m.db.transaction.mockRejectedValueOnce(new Error("db write failed"));
    vi.mocked(updateSubscription).mockResolvedValueOnce({
      id: STRIPE_SUB,
      status: "active",
      currency: "JPY",
    } as never);

    const res = await POST_ROUTES.upgrade(
      jsonRequest("/api/tenant/billing/subscription/upgrade", {
        planId: "pro",
        interval: "month",
      }),
    );
    expect(res.status).toBe(500);

    const desynced = m.state.markers.filter(
      (x) => x.eventType === "subscription.upgrade_desynced",
    );
    expect(desynced).toHaveLength(1);
    expect(desynced[0]!.currency).toBe("jpy");
  });
});

describe("the invoices read site ships data, not an invented dollar sign", () => {
  it("passes the amount through raw and keeps an unknown currency null", async () => {
    m.state.invoiceRows = [
      {
        id: "e1",
        eventType: "subscription.upgraded",
        amount: "50.00",
        currency: "eur",
        stripeInvoiceId: null,
        stripeSubscriptionId: STRIPE_SUB,
        metadata: {},
        createdAt: new Date("2026-09-01"),
      },
      {
        id: "e2",
        eventType: "subscription.cancel_scheduled",
        amount: "0",
        currency: null,
        stripeInvoiceId: null,
        stripeSubscriptionId: STRIPE_SUB,
        metadata: {},
        createdAt: new Date("2026-09-02"),
      },
    ];

    const res = await invoicesGET(
      jsonRequest("/api/tenant/billing/invoices") as unknown as NextRequest,
    );
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };

    expect(body.data[0]).toMatchObject({ amount: "50.00", currency: "eur" });
    expect(body.data[1]).toMatchObject({ amount: "0", currency: null });
    expect(JSON.stringify(body)).not.toContain("$");
  });
});

describe("#2551 source scan — no write site may hard-code a currency", () => {
  const ROOT = process.cwd();
  const WRITE_SITES = [
    "app/api/tenant/billing/subscription/upgrade/route.ts",
    "app/api/tenant/billing/subscription/cancel/route.ts",
    "app/api/tenant/billing/subscription/resume/route.ts",
    "app/api/tenant/billing/subscription/downgrade/route.ts",
    "app/api/tenant/billing/dunning/retry/route.ts",
  ];

  it.each(WRITE_SITES)(
    "%s never stamps a literal currency into billing_events",
    (file) => {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src).not.toMatch(/currency:\s*['"]usd['"]/);
      expect(src).not.toMatch(/billingCurrency\s*=\s*['"]usd['"]/);
    },
  );

  it("the dunning fallback is declared nullable, so NULL is a legal value", () => {
    const src = readFileSync(
      join(ROOT, "app/api/tenant/billing/dunning/retry/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/let billingCurrency: string \| null = null;/);
  });

  it("the invoices read site neither prefixes $ nor coalesces to usd", () => {
    const src = readFileSync(
      join(ROOT, "app/api/tenant/billing/invoices/route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/currency:\s*e\.currency\s*\|\|/);
    expect(src).not.toMatch(/`\$\$\{/);
  });

  it("the invoices page renders a symbol only for a real currency code", () => {
    const src = readFileSync(
      join(ROOT, "app/tenant/settings/billing/invoices/page.tsx"),
      "utf8",
    );
    expect(src).toContain("isRenderableCurrencyCode");
    expect(src).not.toMatch(/amount:\s*string;/);
  });
});

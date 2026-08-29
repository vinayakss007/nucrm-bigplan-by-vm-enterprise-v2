# Billing Lifecycle Test Harness (#1477)

An automated, runnable harness that drives the **full Stripe billing lifecycle**
against a running NuCRM instance in **Stripe TEST mode** and asserts API/DB
state at every step.

- Script: [`scripts/billing-lifecycle-test.ts`](../scripts/billing-lifecycle-test.ts)
- Pure helpers (signer / fixtures / assertions): [`scripts/billing-harness/`](../scripts/billing-harness/)
- Run: `npm run test:billing`
- Tracks issue **#1477** (automated billing-lifecycle test harness).

> The harness **cannot** run inside CI/build sandboxes (no Stripe keys, no
> running app). It fails fast with a clear message when required env is missing.
> The **repo owner** runs it against Stripe TEST keys following this runbook.

---

## 1. Purpose

Give a single command that verifies, end-to-end, that:

- A tenant can select a plan and be **activated** by `checkout.session.completed`.
- Plan **entitlements/limits** are reflected on the billing API.
- Invoices carry unique, monotonic numbers (`INV-#####`, **#1462**).
- Renewals keep a tenant active.
- Failed payments move a tenant to `past_due` and the dunning **retry cap
  (#1464)** is enforced.
- Stripe status → NuCRM status **mapping (#1463)** is correct and a tenant in a
  terminal state is **not** silently re-activated.
- Cancellation (`customer.subscription.deleted`) downgrades the tenant to `free`.
- The webhook handler is **idempotent** (#1287): a duplicate event id returns
  `{ duplicate: true }`.

The harness uses a **signed-webhook relay**: it signs Stripe event fixtures with
your `STRIPE_WEBHOOK_SECRET` (reproducing Stripe's exact HMAC scheme) and POSTs
them to `/api/webhooks/stripe`. This means **you do not need a public webhook
endpoint** (no Stripe CLI tunnel / ngrok) to exercise webhook-driven steps.

---

## 2. Prerequisites

- **Stripe TEST keys** (never live). The secret key must start with `sk_test_`.
- **Stripe test prices** created in your Stripe dashboard for the plans you want
  to assert plan-mapping on, and their price IDs exported (see below).
- A **running app** reachable at `APP_URL` (e.g. a dev/staging deploy).
- A **test admin login** (email + password) whose account is an admin of the
  tenant under test.
- A **test tenant** (optionally pinned via `TEST_TENANT_ID`).

---

## 3. Environment variables

| Variable                          | Required | Notes                                                                                  |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `STRIPE_TEST_SECRET_KEY`          | ✅       | Must start with `sk_test_`. Mapped to `STRIPE_SECRET_KEY` at runtime.                  |
| `STRIPE_WEBHOOK_SECRET`           | ✅       | `whsec_...` — used to sign relayed webhook fixtures.                                   |
| `APP_URL`                         | ✅       | Base URL of the running app, e.g. `https://staging.example.com`.                       |
| `TEST_ADMIN_EMAIL`                | ⬜       | Defaults to `t@t.com`.                                                                 |
| `TEST_ADMIN_PASSWORD`             | ⬜       | Defaults to `password123`.                                                             |
| `STRIPE_PRICE_STARTER_MONTHLY`    | ⬜       | If set, harness asserts checkout maps to `starter`.                                    |
| `STRIPE_PRICE_PRO_MONTHLY`        | ⬜       | Optional price id.                                                                     |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY` | ⬜       | Optional price id.                                                                     |
| `TEST_TENANT_ID`                  | ⬜       | Pin the **real `tenants.id`** to drive the lifecycle against (see note).               |
| `SUPERADMIN_EMAIL`                | ⬜       | If set (with password), asserts tenant state via the **uncached** superadmin endpoint. |
| `SUPERADMIN_PASSWORD`             | ⬜       | Superadmin password. Recommended — avoids the workspace cache caveat.                  |

> **Tenant identity (important).** State assertions read the `tenants` table
> (the table every Stripe webhook writes). The harness resolves the **real
> `tenants.id`** from `TEST_TENANT_ID`, or — if unset — from
> `GET /api/tenant/workspace` (`data.id`) for the logged-in admin. It **never**
> uses the `subscriptions` row id. If neither yields a tenant id, the run aborts
> with guidance. Pin `TEST_TENANT_ID` for a deterministic run.

> **Where tenant state is read (cache caveat).** If `SUPERADMIN_EMAIL` /
> `SUPERADMIN_PASSWORD` are provided, post-webhook `status`/`planId` assertions
> use `GET /api/superadmin/tenants/<id>`, which reads `tenants` **uncached** —
> the most reliable source. Without superadmin creds, the harness falls back to
> `GET /api/tenant/workspace`, which is **dbCache'd for ~2 minutes** (key
> `workspace:<tenantId>`); a read immediately after a webhook can be **stale**.
> The harness retries the workspace read a few times to tolerate this, but
> providing superadmin creds is strongly recommended for time-sensitive
> assertions.

Copy-paste export block (**replace placeholders — never commit real secrets**):

```bash
export STRIPE_TEST_SECRET_KEY="sk_test_REPLACE_ME"
export STRIPE_WEBHOOK_SECRET="whsec_REPLACE_ME"
export APP_URL="https://your-running-app.example.com"
export TEST_ADMIN_EMAIL="t@t.com"
export TEST_ADMIN_PASSWORD="password123"
# Strongly recommended — uncached tenant-table assertions (no cache caveat):
export SUPERADMIN_EMAIL="superadmin@example.com"
export SUPERADMIN_PASSWORD="REPLACE_ME"
# Recommended — pins the REAL tenants.id (not the subscriptions row id):
export TEST_TENANT_ID="00000000-0000-0000-0000-000000000000"
# Optional — enables plan-mapping and richer assertions:
export STRIPE_PRICE_STARTER_MONTHLY="price_REPLACE_ME"
export STRIPE_PRICE_PRO_MONTHLY="price_REPLACE_ME"
export STRIPE_PRICE_ENTERPRISE_MONTHLY="price_REPLACE_ME"
```

---

## 4. How to run

```bash
npm run test:billing
# or directly:
tsx scripts/billing-lifecycle-test.ts
```

With required env **unset**, the harness prints exactly which variables are
missing and exits with a non-zero code (graceful failure) — no live calls are
attempted.

---

## 5. #1477 lifecycle step → endpoint → assertion

Stripe webhook handlers write the **`tenants`** table
(`status`/`planId`/`stripeSubscriptionId`/`billingType`). Therefore every
post-webhook **status/planId** assertion reads a **`tenants`-backed** endpoint
— `GET /api/superadmin/tenants/<id>` (uncached, preferred) or
`GET /api/tenant/workspace` (cached ~2min, fallback). The
`GET /api/tenant/billing/subscription` endpoint reads the **`subscriptions`**
table and is used **only** where that is genuinely correct: reading plan
**limits** (`plan.maxContacts` …) and the real **`subscriptions.id`** used by
the retry-cap step.

| #   | Lifecycle step                      | Driver / endpoint                                                          | Assertion source & expectation                                                                                                                                                                                                                                                   |
| --- | ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Auth                                | `POST /api/auth/login` (admin; optional superadmin)                        | Session + CSRF cookies captured and reused; superadmin session enables uncached tenant reads.                                                                                                                                                                                    |
| 1   | Signup / provisioning               | `TEST_TENANT_ID` or `GET /api/tenant/workspace` `data.id`                  | Resolves the **real `tenants.id`** (never the subscriptions row id); aborts with guidance if unavailable.                                                                                                                                                                        |
| 2   | Plan select / subscription          | Stripe `createCustomer` (TEST) → relay `checkout.session.completed`        | Handler `200 { received: true }`; re-POST → `{ duplicate: true }`. **tenants** endpoint: `status='active'`, `planId` mapped.                                                                                                                                                     |
| 3   | Entitlements / limits               | `GET /api/tenant/billing/subscription`                                     | **subscriptions/plan** endpoint (correct here): `plan.maxContacts` etc. exposed.                                                                                                                                                                                                 |
| 4   | Invoice / payment                   | relay `invoice.payment_succeeded`                                          | **tenants** endpoint: tenant stays `active`.                                                                                                                                                                                                                                     |
| 4b  | Invoice numbering (**#1462**)       | `POST /api/tenant/invoices` ×2                                             | Both match `^INV-\d{5}$`, unique, strictly increasing.                                                                                                                                                                                                                           |
| 5   | Renewal                             | relay synthetic `invoice.payment_succeeded` (test clock = manual)          | **tenants** endpoint: tenant remains `active`.                                                                                                                                                                                                                                   |
| 5b  | Missing-metadata guard (**#5**)     | relay `customer.subscription.updated` with **no `metadata.tenant_id`**     | **tenants** endpoint: state **UNCHANGED** — handler resolves tenant only via `metadata.tenant_id` and drops the event.                                                                                                                                                           |
| 6   | Dunning (failed payment)            | relay `invoice.payment_failed`                                             | **tenants** endpoint: tenant → `past_due`.                                                                                                                                                                                                                                       |
| 6b  | Dunning retry cap (**#1464**)       | `POST /api/tenant/billing/dunning/retry` × (maxRetries+1)                  | Uses real `subscriptions.id` from the subscription endpoint. `attemptNumber` monotonic; cap+1 → `400 'Maximum retry attempts'`. **SKIPs** if no subscriptions row (see §7).                                                                                                      |
| 8   | Status mapping (**#1463**)          | relay `customer.subscription.updated` (`past_due`/`incomplete`/`canceled`) | **tenants** endpoint: `past_due`→`past_due`; `incomplete`→`past_due` (NOT active); `canceled`→`cancelled`.                                                                                                                                                                       |
| 7   | Manual-suspension guard (**#1463**) | relay terminal update then routine `active`                                | **tenants** endpoint: a terminal tenant is **not** re-activated by a routine `subscription.updated=active`.                                                                                                                                                                      |
| 9   | Cancellation / downgrade            | relay `customer.subscription.deleted`                                      | **tenants** endpoint: `planId='free'`, `status='active'`. The handler clears `stripeSubscriptionId` in the **same atomic update**; since no tenant endpoint exposes that column, the co-written `planId=free & status=active` is asserted as the observable proxy for the clear. |

**Test payment methods (Stripe TEST only):** `pm_card_visa` (success),
`pm_card_chargeCustomerFail` / PAN `4000000000000341` (failure).

---

## 6. Reading the output

Each step prints a line:

```
[PASS] checkout.session.completed: handler returns 200
[FAIL] dunning: tenant becomes past_due — expected one of ["past_due"], got "active"
```

followed by a summary:

```
Passed: 20  Failed: 0  Total: 20
```

**Exit code:** `0` if every check passed, `1` if any check failed **or** if
required env was missing / a live key was supplied. Wire `npm run test:billing`
into CI or a pre-release gate and treat non-zero as a failure.

---

## 7. Manual / owner-only steps

Some steps cannot be fully automated in every environment:

- **Renewal via Stripe test clocks.** The harness relays a synthetic
  `invoice.payment_succeeded` to prove renewal handling. To exercise a _real_
  renewal, create a Stripe **test clock**, attach the customer/subscription,
  and **advance the clock** in the Stripe dashboard (Developers → Test clocks)
  to force a renewal invoice. This dashboard advancement is manual.
- **Terminal suspension.** Putting a tenant into `suspended`/`deleted` is an
  owner/superadmin action. The harness asserts the guard using the `cancelled`
  terminal state it can reach via webhooks; use the superadmin tooling to test
  `suspended`/`deleted` if desired.
- **Public webhook endpoint.** Not required — the **signed-relay** approach
  signs fixtures with your `STRIPE_WEBHOOK_SECRET` and POSTs directly to
  `/api/webhooks/stripe`, so no Stripe CLI tunnel or ngrok is needed.
- **Retry-cap prerequisite (a `subscriptions` row).** The dunning retry
  endpoint (`POST /api/tenant/billing/dunning/retry`) locks the tenant's
  `subscriptions` row `FOR UPDATE`, so step **6b** needs an existing
  `subscriptions` row for `TEST_TENANT_ID`. Stripe webhooks write the
  **`tenants`** table, not `subscriptions`, so the harness does not create one.
  When no row exists the harness resolves no `subscriptions.id` (from
  `GET /api/tenant/billing/subscription`) and **SKIPs** the retry-cap check with
  an explanatory, non-failing message. To exercise the cap, seed a
  `subscriptions` row for the tenant first (e.g. via `npm run seed:dev` or your
  billing bootstrap), then re-run.
- **Uncached vs cached tenant reads.** For deterministic post-webhook
  assertions, provide `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` so the harness
  reads `tenants` uncached via `GET /api/superadmin/tenants/<id>`. Without them
  it falls back to the ~2-minute-cached `GET /api/tenant/workspace` and retries
  the read to tolerate cache latency.

---

## 8. SECURITY

- **Use TEST keys and TEST cards only.** The harness refuses to run if
  `STRIPE_TEST_SECRET_KEY` does not start with `sk_test_`.
- **Never commit secrets.** All keys are read from the environment; the harness
  redacts them in output (only the last 4 characters are shown).
- **No card PANs are logged in full.** Only the documented Stripe test tokens
  are referenced.

---

## 9. Razorpay parity (follow-up)

This harness covers the **Stripe** path fully. NuCRM also has a Razorpay webhook
path (`app/api/webhooks/razorpay/route.ts`). A matching Razorpay lifecycle
harness is tracked as a **follow-up** and is intentionally out of scope for
#1477.

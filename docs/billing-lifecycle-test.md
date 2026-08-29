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

| Variable                          | Required | Notes                                                                 |
| --------------------------------- | -------- | --------------------------------------------------------------------- |
| `STRIPE_TEST_SECRET_KEY`          | ✅       | Must start with `sk_test_`. Mapped to `STRIPE_SECRET_KEY` at runtime. |
| `STRIPE_WEBHOOK_SECRET`           | ✅       | `whsec_...` — used to sign relayed webhook fixtures.                  |
| `APP_URL`                         | ✅       | Base URL of the running app, e.g. `https://staging.example.com`.      |
| `TEST_ADMIN_EMAIL`                | ⬜       | Defaults to `t@t.com`.                                                |
| `TEST_ADMIN_PASSWORD`             | ⬜       | Defaults to `password123`.                                            |
| `STRIPE_PRICE_STARTER_MONTHLY`    | ⬜       | If set, harness asserts checkout maps to `starter`.                   |
| `STRIPE_PRICE_PRO_MONTHLY`        | ⬜       | Optional price id.                                                    |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY` | ⬜       | Optional price id.                                                    |
| `TEST_TENANT_ID`                  | ⬜       | Pin the tenant to drive the lifecycle against.                        |

Copy-paste export block (**replace placeholders — never commit real secrets**):

```bash
export STRIPE_TEST_SECRET_KEY="sk_test_REPLACE_ME"
export STRIPE_WEBHOOK_SECRET="whsec_REPLACE_ME"
export APP_URL="https://your-running-app.example.com"
export TEST_ADMIN_EMAIL="t@t.com"
export TEST_ADMIN_PASSWORD="password123"
# Optional — enables plan-mapping and richer assertions:
export STRIPE_PRICE_STARTER_MONTHLY="price_REPLACE_ME"
export STRIPE_PRICE_PRO_MONTHLY="price_REPLACE_ME"
export STRIPE_PRICE_ENTERPRISE_MONTHLY="price_REPLACE_ME"
export TEST_TENANT_ID="00000000-0000-0000-0000-000000000000"
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

| #   | Lifecycle step                      | Driver / endpoint                                                          | Assertion                                                                                                     |
| --- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0   | Auth                                | `POST /api/auth/login`                                                     | Session + CSRF cookies captured and reused on later calls.                                                    |
| 1   | Signup / provisioning               | `GET /api/tenant/billing/subscription`                                     | Billing endpoint reachable; baseline status/planId recorded.                                                  |
| 2   | Plan select / subscription          | Stripe `createCustomer` (TEST) → relay `checkout.session.completed`        | Handler `200 { received: true }`; re-POST → `{ duplicate: true }`; tenant `status='active'`, `planId` mapped. |
| 3   | Entitlements / limits               | `GET /api/tenant/billing/subscription`                                     | `plan.maxContacts` etc. exposed.                                                                              |
| 4   | Invoice / payment                   | relay `invoice.payment_succeeded`                                          | Tenant stays `active`.                                                                                        |
| 4b  | Invoice numbering (**#1462**)       | `POST /api/tenant/invoices` ×2                                             | Both match `^INV-\d{5}$`, unique, strictly increasing.                                                        |
| 5   | Renewal                             | relay synthetic `invoice.payment_succeeded` (test clock = manual)          | Renewal processed (200); tenant remains `active`.                                                             |
| 6   | Dunning (failed payment)            | relay `invoice.payment_failed`                                             | Tenant → `past_due`.                                                                                          |
| 6b  | Dunning retry cap (**#1464**)       | `POST /api/tenant/billing/dunning/retry` × (maxRetries+1)                  | `attemptNumber` increments monotonically; the cap+1 call returns `400 'Maximum retry attempts'`.              |
| 8   | Status mapping (**#1463**)          | relay `customer.subscription.updated` (`past_due`/`incomplete`/`canceled`) | `past_due`→`past_due`; `incomplete`→`past_due` (NOT active); `canceled`→`cancelled`.                          |
| 7   | Manual-suspension guard (**#1463**) | relay terminal update then routine `active`                                | A terminal tenant is **not** re-activated by a routine `subscription.updated=active`.                         |
| 9   | Cancellation / downgrade            | relay `customer.subscription.deleted`                                      | `planId='free'`, `status='active'`, `stripeSubscriptionId=null`.                                              |

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

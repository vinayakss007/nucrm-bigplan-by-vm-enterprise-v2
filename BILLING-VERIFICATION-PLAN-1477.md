# Test-Mode Billing Verification Plan (Issue #1477)

An execution-ready, end-to-end verification checklist for the full billing
lifecycle across the three payment providers NuCRM integrates: **Stripe**,
**Razorpay**, and **PayU**. It covers signup and provisioning, plan and
subscription entitlements, subscription-status mapping (#1463), invoice
numbering (#1462), dunning (#1464), proration, webhook idempotency (#1274),
refund and cancellation, and currency / integer-minor-unit correctness.

This plan is meant for a QA engineer running against a live app in **provider
test mode** (Stripe test keys, Razorpay test keys, PayU test mode). It does not
change any product code.

## What already exists (and what this plan adds)

An automated Stripe test-mode harness already exists and MUST be run first for
the Stripe path:

- Script: `scripts/billing-lifecycle-test.ts` (run via `npm run test:billing`).
- Pure helpers: `scripts/billing-harness/{webhook-sign,fixtures,assert}.ts`.
- Runbook: `docs/billing-lifecycle-test.md`.

That harness drives the Stripe lifecycle with a signed-webhook relay (it signs
Stripe event fixtures with `STRIPE_WEBHOOK_SECRET` and POSTs them to
`/api/webhooks/stripe`, so no public tunnel is needed). Per its section 9, the
existing runbook covers **Stripe only** and leaves Razorpay parity plus PayU as
follow-up.

This plan does three things:

1. Cross-references the existing Stripe harness / runbook rather than
   duplicating it.
2. Adds full **Razorpay** and **PayU** manual test-mode coverage that the
   existing docs leave out.
3. Adds a manual, provider-agnostic run-through, a fix-presence
   re-confirmation table, an automated-vs-manual coverage matrix, and a
   sign-off section.

Every table below has an empty **Actual / Pass-Fail** column for the tester to
fill in during the run.

---

## 1. Prerequisites

### 1.1 Environment variables per provider

Verified against source. Note the doc gap flagged in the last column.

| Provider | Variable                                                     | Source (verified)                                      | In `.env.example`? |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------ | ------------------ |
| Stripe   | `STRIPE_SECRET_KEY`                                          | `.env.example`, `lib/stripe.ts`                        | Yes                |
| Stripe   | `STRIPE_WEBHOOK_SECRET`                                      | `.env.example`, `lib/stripe.ts`                        | Yes                |
| Stripe   | `STRIPE_PRICE_{STARTER,PRO,ENTERPRISE}_{MONTHLY,YEARLY}`     | `app/api/webhooks/stripe/route.ts` price mapping       | No (doc gap)       |
| Razorpay | `RAZORPAY_KEY_ID`                                            | `lib/razorpay.ts` `isRazorpayConfigured`, `getKeyId`   | No (doc gap)       |
| Razorpay | `RAZORPAY_KEY_SECRET`                                        | `lib/razorpay.ts` `getKeySecret`                       | No (doc gap)       |
| Razorpay | `RAZORPAY_WEBHOOK_SECRET`                                    | `lib/razorpay.ts` `getWebhookSecret`                   | No (doc gap)       |
| PayU     | `PAYU_MERCHANT_KEY`                                          | `lib/payu.ts` `isPayUConfigured`, `createPaymentLink`  | No (doc gap)       |
| PayU     | `PAYU_MERCHANT_SALT`                                         | `lib/payu.ts` `generatePayUHash`, `verifyPayUResponse` | No (doc gap)       |
| PayU     | `PAYU_MODE` (`test` default; `production` switches base URL) | `lib/payu.ts` `getPayUBaseUrl`                         | No (doc gap)       |
| Cron     | `CRON_SECRET` (sent as `x-cron-secret` header)               | `.env.example`, `lib/auth/cron.ts`                     | Yes                |

**Doc gap to report (do not fix here):** only Stripe (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`) and `CRON_SECRET` are listed in `.env.example`. The
Razorpay, PayU, and Stripe price-id variables are documented only in their
respective `lib/*.ts` files. Recommend adding a commented Razorpay / PayU block
to `.env.example` in a separate change.

The harness-only variables (not app runtime) used by
`scripts/billing-lifecycle-test.ts` are documented in
`docs/billing-lifecycle-test.md` section 3: `STRIPE_TEST_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `APP_URL`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD`,
`TEST_TENANT_ID`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, and the optional
`STRIPE_PRICE_*_MONTHLY` price ids.

### 1.2 Webhook endpoints

| Provider | Method + URL                  | Signature / verification                                                               |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| Stripe   | `POST /api/webhooks/stripe`   | `stripe-signature` header, `verifyWebhookSignature` (HMAC of raw body).                |
| Razorpay | `POST /api/webhooks/razorpay` | `x-razorpay-signature` header, HMAC-SHA256 of raw body with `RAZORPAY_WEBHOOK_SECRET`. |
| PayU     | `POST /api/webhooks/payu`     | form-POST with `hash` field, reverse SHA-512 hash via `verifyPayUResponse`.            |

How each provider reaches these endpoints in test mode:

- **Stripe:** `stripe listen --forward-to <app>/api/webhooks/stripe` (Stripe
  CLI) or the dashboard webhook, OR the existing harness signed relay (no
  tunnel needed).
- **Razorpay:** configure a dashboard webhook pointing at
  `<app>/api/webhooks/razorpay`; Razorpay sends `x-razorpay-signature`. For a
  local relay you can HMAC-SHA256 the exact raw JSON body with
  `RAZORPAY_WEBHOOK_SECRET` and set that header.
- **PayU:** the payment form posts to PayU with `surl` / `furl` callback URLs;
  PayU form-POSTs the result back. The app derives the payment context from the
  `txnid` (format `NUCRM_{quoteId}_{random}`).

### 1.3 App run mode and seed data

- Run against the running app (pm2 behind nginx, or `npm run dev`). This is not
  a Docker deployment for the app.
- Seed: `npm run seed:dev` (`scripts/seed-dev.ts`) seeds a tenant. Confirm the
  seeded tenant `planId` and plan rows before starting. (verify seeded plan id)
- The dunning retry-cap test needs a real `subscriptions` row for the tenant.
  Stripe webhooks write the `tenants` table, not `subscriptions`, so seed a
  `subscriptions` row first (see `docs/billing-lifecycle-test.md` section 7).

---

## 2. Scope items from #1477

Each of the 8 scope items has trigger steps, the DB `table.column` to inspect,
the expected result, and an empty Actual / Pass-Fail column.

### 2.1 Signup, provisioning, plan selection, entitlements

| Step | Trigger                                                                                | Inspect (table.column)                                                | Expected                                                                                   | Actual / Pass-Fail |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| 1    | Create a new tenant (signup) before any paid checkout                                  | `tenants.status`, `tenants.plan_id`                                   | `status='trialing'` (default), `plan_id='free'` (default)                                  |                    |
| 2    | Complete Stripe checkout: relay `checkout.session.completed` with `metadata.tenant_id` | `tenants.status`, `tenants.plan_id`, `tenants.billing_type`           | `status='active'`, `plan_id` mapped from price (starter fallback), `billing_type='stripe'` |                    |
| 3    | Read entitlements / limits                                                             | `GET /api/tenant/billing/subscription` (reads `subscriptions` + plan) | Plan limits exposed (for example `plan.maxContacts`)                                       |                    |

Notes: `handleCheckoutCompleted` requires `session.metadata.tenant_id`; without
it the event is skipped with a warning. Plan is resolved by price id, then line
item, then an amount heuristic (last resort).

### 2.2 Subscription lifecycle status mapping

See the dedicated Stripe status matrix in section 3. Razorpay and PayU status
outcomes are in sections 4 and 5.

### 2.3 Invoice numbering (#1462)

See the dedicated concurrency and after-soft-delete test in section 7.

### 2.4 Failed payment and dunning (#1464)

See the dedicated dunning cap / attemptNumber test in section 8.

### 2.5 Proration on upgrade / downgrade

See the dedicated proration section 10.

### 2.6 Webhook idempotency (#1274)

See the dedicated idempotency section 6.

### 2.7 Refund and cancellation

| Step | Trigger                                                           | Inspect (table.column)                                                                        | Expected                                                                                                            | Actual / Pass-Fail |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1    | Stripe: relay `customer.subscription.deleted`                     | `tenants.plan_id`, `tenants.status`, `tenants.stripe_subscription_id`, `tenants.billing_type` | `plan_id='free'`, `status='active'` (downgrade, not suspend), `stripe_subscription_id=null`, `billing_type='trial'` |                    |
| 2    | Razorpay: relay `subscription.cancelled` (with `notes.tenant_id`) | `tenants.plan_id`, `tenants.status`, `tenants.billing_type`, `tenants.metadata`               | `plan_id='free'`, `status='cancelled'`, `billing_type='trial'`, `metadata.cancelled_at` set                         |                    |
| 3    | Real refund (Stripe)                                              | Stripe dashboard refund + resulting webhook                                                   | Cannot be fully verified without a real refund; use Stripe test-mode refund (see section 14)                        |                    |

**Divergence to note (report, do not fix):** the two providers set a different
`tenants.status` for cancellation. Stripe cancellation deliberately downgrades
and keeps `status='active'` (`handleSubscriptionDeleted`), while Razorpay
cancellation sets `status='cancelled'` (`handleSubscriptionCancelled`). Document
each provider's expected status separately in any tester's checklist.

### 2.8 Currency and integer minor units

See the dedicated currency section 9 (Razorpay INR paise plus Stripe cents).

---

## 3. Stripe status-mapping matrix (#1463)

This is the heart of #1463. It exactly mirrors the `switch` in
`handleSubscriptionUpdated` in `app/api/webhooks/stripe/route.ts`. Trigger with
`stripe trigger customer.subscription.updated` or a signed relay of a
`customer.subscription.updated` fixture carrying the target `status`.

| Stripe `subscription.status` | Expected `tenants.status` | Notes                                     | Actual / Pass-Fail |
| ---------------------------- | ------------------------- | ----------------------------------------- | ------------------ |
| `active`                     | `active`                  | Paying                                    |                    |
| `trialing`                   | `active`                  | Trial grants access                       |                    |
| `past_due`                   | `past_due`                | Payment late                              |                    |
| `canceled`                   | `cancelled`               | Terminal                                  |                    |
| `unpaid`                     | `cancelled`               | Terminal                                  |                    |
| `incomplete_expired`         | `cancelled`               | Payment never completed                   |                    |
| `incomplete`                 | `past_due`                | Not yet paying; must NOT grant active     |                    |
| `paused`                     | `past_due`                | Temporarily halted; must NOT grant active |                    |
| unknown / future value       | `past_due`                | Fail-safe default; never auto-activate    |                    |

Inspect `tenants.status` and `tenants.plan_id` after each trigger.

### 3.1 Terminal-status guard

| Step | Trigger                                                                                                                                          | Inspect                             | Expected                                                              | Actual / Pass-Fail |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------- | ------------------ |
| 1    | Put the tenant into a terminal state (`suspended`, `deleted`, or `cancelled`), then relay `customer.subscription.updated` with `status='active'` | `tenants.status`, `tenants.plan_id` | `status` stays terminal (NOT re-activated); only `plan_id` is updated |                    |

Source: the guard in `handleSubscriptionUpdated` checks
`terminalStatuses = {suspended, deleted, cancelled}`; when the existing status
is terminal and the incoming mapped status is `active`, it updates only
`plan_id` and returns.

---

## 4. Razorpay lifecycle (manual, test mode)

Signature: `x-razorpay-signature` header, verified by `verifyWebhookSignature`
(HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`). Every handler
resolves the tenant from `notes.tenant_id` on the payment or subscription
entity; without it the event is skipped with a warning, so the payment / plan
must carry `notes.tenant_id`.

Plan normalization (`normalizeRazorpayPlan`): `growth -> pro`,
`scale -> enterprise`; any other id passes through, and empty defaults to
`starter`.

| Event                    | Trigger                                                              | Inspect (table.column)                                                                 | Expected                                                                                                                                            | Actual / Pass-Fail |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `payment.captured`       | Relay signed body with `payload.payment.entity.notes.tenant_id`      | `tenants.status`, `tenants.plan_id`, `tenants.billing_type`                            | `status='active'`, `plan_id` normalized, `billing_type='razorpay'`                                                                                  |                    |
| `subscription.activated` | Relay signed body with `payload.subscription.entity.notes.tenant_id` | `tenants.status`, `tenants.plan_id`, `tenants.billing_type`, `tenants.subscription_id` | `status='active'`, `plan_id` normalized, `billing_type='razorpay'`, `subscription_id` set to the Razorpay sub id                                    |                    |
| `subscription.cancelled` | Relay signed body with `notes.tenant_id`                             | `tenants.plan_id`, `tenants.status`, `tenants.billing_type`, `tenants.metadata`        | `plan_id='free'`, `status='cancelled'` (the #1262 cancelled path; must NOT stay/return active), `billing_type='trial'`, `metadata.cancelled_at` set |                    |
| `payment.failed`         | Relay signed body with `notes.tenant_id`                             | `tenants.status`                                                                       | `status='past_due'`                                                                                                                                 |                    |

**Verification nuance (report, do not fix):** the Razorpay handler returns HTTP
200 even when an inner handler throws (to stop Razorpay retries), whereas the
Stripe handler returns HTTP 500 on failure to force a retry. A 200 from Razorpay
therefore does not by itself prove the side effect landed; always confirm via
the DB columns above.

Idempotency key: `razorpay:evt:{id}`, 24h TTL, where the id is the
`x-razorpay-event-id` header, falling back to the payment entity id, then the
subscription entity id. A redelivery within the TTL returns
`{ received: true, duplicate: true }`. See section 6.

---

## 5. PayU lifecycle (manual, test mode)

PayU sends a form-POST callback with a `hash`. `verifyPayUResponse`
(`PAYU_MERCHANT_SALT`) recomputes the reverse SHA-512 hash and compares it with
a timing-safe check. The `txnid` format is `NUCRM_{quoteId}_{random}`; the
handler extracts `quoteId` and validates it as a UUID. All writes happen inside
a single DB transaction.

| Path                     | Trigger (form-POST fields)                                                 | Inspect (table.column)                                                                                                  | Expected                                                                                                                                                                                                                 | Actual / Pass-Fail |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Success                  | Valid hash, `status=success`, `txnid=NUCRM_{quoteId}_{rand}`, `amount>0`   | `invoice_payments.reference`, `invoice_payments.payment_method`, `invoices.status`, `invoices.paid_at`, `quotes.status` | New `invoice_payments` row (`payment_method='payu'`, `reference=txnid`); `recalculateInvoicePayments` sets `invoices.status='paid'` + `paid_at` on full settlement; `quotes.status='accepted'` (unless already terminal) |                    |
| Success (terminal quote) | Same, but the quote is already `accepted`/`declined`/`expired`/`cancelled` | `quotes.status`                                                                                                         | Quote status is NOT overridden (terminal statuses are never re-flipped to `accepted`)                                                                                                                                    |                    |
| Failure                  | Valid hash, `status` other than `success`                                  | `quotes.metadata` (`payu.failures`, `payu.lastFailedTxnId`, `payu.lastStatus`)                                          | Failure recorded on `quotes.metadata.payu.failures` (deduped by `txnid`, capped to last 10); no invoice mutation                                                                                                         |                    |
| Bad hash                 | Tampered `hash`                                                            | HTTP response                                                                                                           | HTTP 400 `Hash verification failed`; no DB writes                                                                                                                                                                        |                    |
| Bad txnid                | `txnid` whose derived quote id is not a UUID                               | HTTP response                                                                                                           | HTTP 200 with `processed:false, reason:'unrecognized_txnid_format'`; no DB writes                                                                                                                                        |                    |

Idempotency: per-`txnid` inside the transaction. The latest live invoice for the
quote is locked `FOR UPDATE`. On success, if an `invoice_payments` row already
exists with `reference == txnid` (or the invoice is already `paid`), it returns
`{ processed:false, alreadyProcessed:true }` and does NOT insert a second ledger
row. On failure, a duplicate `txnid` already present in
`quotes.metadata.payu.failures` also returns `alreadyProcessed:true`. See
section 6.

---

## 6. Idempotency tests (#1274)

Replay the SAME event id / txnid twice for each provider and assert no
double-row, double-charge, or double-entitlement.

| Provider | Idempotency key                                                                    | First call            | Duplicate call                                 | Assert                                                    | Actual / Pass-Fail |
| -------- | ---------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- | --------------------------------------------------------- | ------------------ |
| Stripe   | `stripe:evt:{event.id}` lock, 24h TTL (`acquireLock`)                              | `{ received: true }`  | `{ received: true, duplicate: true }`          | Tenant state changed exactly once                         |                    |
| Razorpay | `razorpay:evt:{id}` lock, 24h TTL (id = `x-razorpay-event-id`, fallback entity id) | `{ received: true }`  | `{ received: true, duplicate: true }`          | Tenant state changed exactly once                         |                    |
| PayU     | per-`txnid` DB check on `invoice_payments.reference` (or invoice already `paid`)   | `{ processed: true }` | `{ processed: false, alreadyProcessed: true }` | Exactly one `invoice_payments` row with `reference=txnid` |                    |

The existing Stripe harness already automates the Stripe duplicate check (a
re-POST returns `{ duplicate: true }`); Razorpay and PayU idempotency are
manual.

---

## 7. Invoice-number concurrency and after-soft-delete (#1462)

Endpoint: `POST /api/tenant/invoices`. Generation happens inside a transaction
holding `SELECT id FROM tenants WHERE id = ... FOR UPDATE`, deriving the next
sequence from `MAX(...)+1` over the regex-extracted numeric suffix, with
`MAX_RETRIES=3` on a unique violation (`23505`). Format is `INV-#####`
(5-digit zero pad). Unique index `idx_invoices_number` is on
`(tenant_id, invoice_number)`.

| Step | Trigger                                                                      | Inspect (table.column)                   | Expected                                                                                          | Actual / Pass-Fail |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| 1    | Fire N parallel `POST /api/tenant/invoices` for the same tenant              | `invoices.invoice_number`                | All match `^INV-\d{5}$`, all unique, monotonic from `MAX(sequence)+1`; no `23505` leaks to client |                    |
| 2    | Soft-delete the highest-numbered invoice: `DELETE /api/tenant/invoices/{id}` | `invoices.deleted_at`, `invoices.status` | `deleted_at` set, `status='cancelled'` (soft delete; row survives)                                |                    |
| 3    | Create a new invoice after the soft delete                                   | `invoices.invoice_number`                | The new number does NOT reuse the deleted one; `MAX` still sees the surviving (soft-deleted) row  |                    |

**Observation (report, do not fix):** gap-safety after delete holds because
`DELETE` is a soft delete (`deleted_at` set in
`app/api/tenant/invoices/[id]/route.ts`); the soft-deleted row still counts
toward `MAX(sequence)`, so its number is never reused. A hard delete of the
highest row would allow reuse, but the code path only ever soft-deletes.

Existing coverage: `tests/integration/invoice-id.test.ts` and the harness
`checkInvoiceNumbering` step already cover parts of this.

---

## 8. Dunning cap and attemptNumber (#1464)

Endpoint: `POST /api/tenant/billing/dunning/retry` (admin only, requires
`isStripeConfigured`). `maxRetries` comes from `dunning_settings.max_retries`
(default 3). Cap = count of `dunning_attempts` where `status != 'succeeded'`.
`attemptNumber = MAX(attempt_number)+1` across ALL attempts. The subscription
row is locked `FOR UPDATE` inside the transaction.

| Step | Trigger                                                 | Inspect (table.column)            | Expected                                                                   | Actual / Pass-Fail |
| ---- | ------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| 1    | Call retry `maxRetries` times for a seeded subscription | `dunning_attempts.attempt_number` | `attempt_number` increments monotonically (1, 2, 3, ...); each returns 200 |                    |
| 2    | Call retry the `(maxRetries+1)`th time                  | HTTP response                     | HTTP 400 containing `Maximum retry attempts`                               |                    |
| 3    | Inspect billing events for each attempt                 | `billing_events.event_type`       | One `dunning.retry_initiated` row per recorded attempt                     |                    |

**Observation (report, do not fix):** the retry route currently only records the
attempt (`dunning_attempts`) plus a `billing_events` row; it does NOT yet
actually re-charge Stripe (there is an explicit `TODO` noting a background job
would do the real retry). So "failed payment -> dunning" verifies attempt
bookkeeping and the cap, NOT a successful re-charge, in test mode.

---

## 9. Currency and integer minor units

Money is stored as Postgres `decimal` (surfaced as strings). `lib/money.ts`
(`money`, `round2`, `lineTotal`, `sumLineItems`, `documentTotal`) rounds to cents
at each accumulation step (round-half-up on cents). `lib/billing/payments.ts`
uses `toCents` (`Math.round(value * 100) / 100`) when recomputing the invoice
summary from the ledger.

Non-USD example (Razorpay INR paise, integer minor units): `RAZORPAY_PLAN_PRICING`
in `lib/razorpay.ts` stores amounts in paise, for example `starter.month = 149900`
paise = 1,499 INR. Stripe amounts are in cents (`amount_total`).

| Step | Trigger                                                                                     | Inspect (table.column)                                                                                 | Expected                                                                                                | Actual / Pass-Fail |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------ |
| 1    | Create an invoice with multiple line items + tax + discount via `POST /api/tenant/invoices` | `invoice_line_items.total`, `invoices.tax_amount`, `invoices.discount_amount`, `invoices.total_amount` | `sum(line_items.total) + tax - discount == invoices.total_amount` to the cent                           |                    |
| 2    | Record a partial then full PayU payment                                                     | `invoice_payments.amount`, `invoices.amount_paid`, `invoices.balance_due`, `invoices.status`           | `amount_paid = sum(ledger)`; `balance_due = total - amount_paid`; status moves `partially_paid -> paid` |                    |
| 3    | Confirm the Razorpay paise figures                                                          | `RAZORPAY_PLAN_PRICING` (code constant)                                                                | `starter.month = 149900` paise = 1,499 INR (integer minor unit, no float)                               |                    |

**Observation (report, do not fix):** currency consistency risk.
`billing_events.currency` is hard-coded `'usd'` in the upgrade and dunning-retry
routes, and `service_subscriptions.currency` defaults to `'USD'`, even though
Razorpay pricing is INR paise. Report as a currency-consistency risk; do not fix
in this task.

---

## 10. Proration on upgrade / downgrade

Endpoints: `POST /api/tenant/billing/subscription/upgrade` and the matching
downgrade route. Both require `isStripeConfigured` and an admin caller. They
proxy Stripe's proration by calling `updateSubscription`; the proration math
happens in Stripe.

| Step | Trigger                                                                | Inspect                                                                                                                   | Expected                                                                                 | Actual / Pass-Fail |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| 1    | Upgrade `starter -> pro` via the upgrade endpoint                      | `subscriptions.plan_id`, `subscriptions.status`, `subscriptions.current_period_start`, `subscriptions.current_period_end` | `plan_id='pro'`, `status='active'`, period start/end synced from the Stripe subscription |                    |
| 2    | Inspect Stripe proration                                               | Stripe dashboard invoice / proration line                                                                                 | Proration line matches the provider math (compare against dashboard)                     |                    |
| 3    | Check billing event                                                    | `billing_events.event_type`                                                                                               | A `subscription.upgraded` row is written                                                 |                    |
| 4    | Attempt a non-upgrade (target `priceMonthly` not greater than current) | HTTP response                                                                                                             | HTTP 400 `This is not an upgrade. Use downgrade endpoint instead.`                       |                    |

**Note:** Razorpay and PayU do not implement proration in this codebase
(verify); mark those provider rows accordingly during the run.

---

## 11. Fix-presence re-confirmation

Eyeball-confirm each fix is present in code BEFORE behavioral testing.

| Issue | File + approach                                                                                                                               | Verify command                                                                                                                    | Actual / Pass-Fail |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| #1462 | `app/api/tenant/invoices/route.ts`: `MAX(regex sequence)+1`, `SELECT ... FOR UPDATE` on `tenants`, `MAX_RETRIES=3` on `23505`                 | `grep -n "FOR UPDATE\|MAX_RETRIES\|invoiceNumber" app/api/tenant/invoices/route.ts`                                               |                    |
| #1463 | `app/api/webhooks/stripe/route.ts`: explicit status `switch` in `handleSubscriptionUpdated` plus the terminal-status guard                    | `grep -n "nuCrmStatus\|terminalStatuses\|case 'incomplete'" app/api/webhooks/stripe/route.ts`                                     |                    |
| #1464 | `app/api/tenant/billing/dunning/retry/route.ts`: cap = count `ne 'succeeded'`, `attemptNumber = MAX+1`, `DunningCapReached`, sub `FOR UPDATE` | `grep -n "DunningCapReached\|attemptNumber\|FOR UPDATE\|ne(dunningAttempts.status" app/api/tenant/billing/dunning/retry/route.ts` |                    |
| #1454 | Lead-to-deal conversion (tangential to billing, non-billing). Cite the conversion route if quickly locatable                                  | `grep -rn "convert" app/api/tenant/leads` (verify; tangential, non-billing)                                                       |                    |

Note on #1454: it concerns lead-to-deal conversion, which is tangential to
billing. Treat as `verify (tangential, non-billing)` unless the conversion route
is confirmed during the run.

---

## 12. Automated vs manual coverage matrix

| Scope item                        | Automated? | Cite                                                                                                         | Manual test-mode needed?                          |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Stripe full lifecycle             | Yes        | `scripts/billing-lifecycle-test.ts` (`npm run test:billing`), `tests/unit/billing-lifecycle-harness.test.ts` | Real test-clock renewal (manual, dashboard)       |
| Stripe signature / tenant resolve | Yes        | `tests/unit/stripe.test.ts`, `tests/unit/billing/stripe-webhook-subscription-tenant.test.ts`                 | No                                                |
| Invoice numbering (#1462)         | Yes        | `tests/integration/invoice-id.test.ts` + harness `checkInvoiceNumbering`                                     | Concurrency at scale + after-soft-delete (manual) |
| Money / integer-cents math        | Yes        | `tests/unit/money.test.ts`, `tests/unit/billing/invoice-payments.test.ts`                                    | End-to-end INR paise reconciliation (manual)      |
| Razorpay signature / hash logic   | Yes (unit) | `tests/unit/razorpay.test.ts`                                                                                | Full Razorpay lifecycle (manual, no e2e)          |
| PayU hash logic                   | Yes (unit) | `tests/unit/payu.test.ts`                                                                                    | Full PayU lifecycle (manual, no e2e)              |
| Billing API routes                | Yes        | `tests/integration/api-routes-billing.test.ts`                                                               | No                                                |
| Dunning cap (#1464)               | Partial    | harness dunning step (needs seeded `subscriptions` row)                                                      | Cap behavior with real subscription (manual)      |
| Proration                         | No         | -                                                                                                            | Proration math vs Stripe dashboard (manual)       |
| Refund                            | No         | -                                                                                                            | Real refund flow (manual)                         |

Recommended gaps (do NOT write test code here): add a Razorpay lifecycle harness
and a PayU lifecycle harness mirroring the Stripe signed-relay approach, so the
two non-USD providers get automated end-to-end coverage.

---

## 13. Sign-off / acceptance

Run-through summary (fill Actual during the run):

| Area                           | Expected                                                                   | Actual / Pass-Fail |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------ |
| Stripe harness                 | `npm run test:billing` reports `Failed: 0`                                 |                    |
| Signup -> provisioning         | New tenant `trialing` / `free`, then `active` / mapped plan after checkout |                    |
| Stripe status mapping (#1463)  | All rows in section 3 match; terminal guard holds                          |                    |
| Invoice numbering (#1462)      | Unique, monotonic `INV-#####`; soft-delete does not reuse numbers          |                    |
| Dunning cap (#1464)            | `attempt_number` monotonic; `maxRetries+1` returns 400                     |                    |
| Razorpay lifecycle             | All rows in section 4 match                                                |                    |
| PayU lifecycle                 | All rows in section 5 match                                                |                    |
| Idempotency (#1274)            | No double-row / double-charge for any provider                             |                    |
| Currency / integer minor units | Invoice reconciles to the cent; INR paise are integers                     |                    |
| Proration                      | Stripe proration matches dashboard; `subscription.upgraded` recorded       |                    |

P0 bug re-verification checkboxes:

- [ ] #1462 invoice numbering re-verified
- [ ] #1463 Stripe status mapping + terminal guard re-verified
- [ ] #1464 dunning cap + attemptNumber re-verified
- [ ] #1454 lead-to-deal conversion re-verified (verify; tangential, non-billing)

Sign-off: tester \***\*\*\*\*\***\_\_\***\*\*\*\*\*** date \***\*\*\*\*\***\_\_\***\*\*\*\*\***

---

## 14. Cannot be verified in test mode (closest proxies)

| Real-world event            | Closest test-mode proxy                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Real bank decline           | Stripe test card `4000000000000341` / `pm_card_chargeCustomerFail` to force `invoice.payment_failed` |
| Forced `past_due` / dunning | `stripe trigger invoice.payment_failed`                                                              |
| Real renewal timing         | Stripe test clocks (dashboard, manual advance per `docs/billing-lifecycle-test.md` section 7)        |
| Razorpay / PayU declines    | Provider test-mode failure simulations (Razorpay test dashboard; PayU test-mode failure response)    |
| Real refund                 | Stripe test-mode refund from the dashboard on a test-mode charge                                     |

Stripe test tokens used by the existing harness: `pm_card_visa` (success),
`pm_card_chargeCustomerFail` / PAN `4000000000000341` (failure).

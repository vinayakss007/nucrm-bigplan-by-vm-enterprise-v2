/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * The currency a `billing_events` row is allowed to carry.
 *
 * Why this exists as one site: `plans` (drizzle/schema/billing.ts:357) and
 * `subscriptions` (`:399`) have NO currency column — so nothing in this
 * database can answer "what currency was this charged in". The payment provider
 * is the only source, and #1909 already reads it that way in
 * `app/api/tenant/billing/dunning/retry/route.ts`. Everywhere else the code
 * guessed the literal `'usd'`, which stamps a wrong fact into the money ledger
 * for any tenant whose Stripe prices are not USD — and the column default
 * (`billing_events.currency` default `'usd'`) means an omitted field guesses too.
 *
 * The rule this module encodes: **a guess is not an answer.** When the caller
 * has no provider response yet — a marker written before the Stripe call, or a
 * schedule-only change like the period-end downgrade — the honest value is
 * NULL. The column is nullable in the live schema (measured on pre-prod through
 * the READ ONLY probe path: `is_nullable = YES`), so NULL needs no migration.
 * `app/api/tenant/billing/invoices/route.ts` renders that NULL as an unknown
 * currency instead of inventing `usd`.
 */

/**
 * Lower-cased ISO code from a provider response, or `null` when it does not
 * answer — lower-case is the ledger's existing convention
 * (`app/api/webhooks/stripe/route.ts` stores Stripe's own lower-case code).
 * Provider responses are passed as they came back, and `unknown` keeps this
 * module from restating (or having to widen) the provider's type to borrow one
 * field.
 */
export function currencyFromProvider(providerResponse: unknown): string | null {
  if (typeof providerResponse !== "object" || providerResponse === null)
    return null;
  const raw = (providerResponse as { currency?: unknown }).currency;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return code.length > 0 ? code : null;
}

/**
 * Is a stored code safe to hand to `Intl.NumberFormat`? Rows are older than any
 * rule here, so the read side validates before formatting — an arbitrary string
 * makes `Intl` throw, which would take down the whole billing page for one bad
 * row.
 */
export function isRenderableCurrencyCode(code: unknown): code is string {
  return typeof code === "string" && /^[a-z]{3}$/i.test(code);
}

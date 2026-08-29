/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1477 — Runnable Stripe billing-lifecycle test harness.
 *
 * Drives the full billing lifecycle against a RUNNING NuCRM instance in Stripe
 * TEST mode and asserts API/DB state at every step. It uses the pure helpers
 * from scripts/billing-harness/* (webhook signer, event fixtures, assertions).
 *
 * This script CANNOT run in the build sandbox (no Stripe keys, no running app):
 * it fails fast with a clear, non-secret message when required env is missing.
 * The repo owner runs it against Stripe TEST keys per docs/billing-lifecycle-test.md.
 *
 * Run:  npm run test:billing   (or: tsx scripts/billing-lifecycle-test.ts)
 *
 * SECURITY: reads all secrets from env; never logs full keys or card PANs
 * (uses redact()); refuses to run against a live (sk_live_) key; uses Stripe
 * TEST payment methods only (pm_card_visa, pm_card_chargeCustomerFail).
 */

import {
  signStripeWebhook,
} from './billing-harness/webhook-sign';
import {
  buildCheckoutSessionCompleted,
  buildSubscriptionUpdated,
  buildSubscriptionDeleted,
  buildInvoicePaymentSucceeded,
  buildInvoicePaymentFailed,
  type StripeEventEnvelope,
} from './billing-harness/fixtures';
import {
  assertEqual,
  assertOneOf,
  assertTrue,
  formatCheck,
  summarize,
  redact,
  type Check,
} from './billing-harness/assert';

// ── Stripe TEST payment methods (safe to keep in source) ─────────────────────
// Documented test tokens — NOT secrets. See Stripe testing docs.
const PM_CARD_SUCCESS = 'pm_card_visa';
const PM_CARD_FAILURE = 'pm_card_chargeCustomerFail';
const CARD_PAN_FAILURE = '4000000000000341';

// ── Config ───────────────────────────────────────────────────────────────────

interface HarnessConfig {
  stripeTestSecretKey: string;
  stripeWebhookSecret: string;
  appUrl: string;
  adminEmail: string;
  adminPassword: string;
  priceStarterMonthly?: string;
  priceProMonthly?: string;
  priceEnterpriseMonthly?: string;
  tenantId?: string;
}

interface EnvResult {
  ok: boolean;
  config?: HarnessConfig;
  missing: string[];
  message?: string;
}

const DEFAULT_ADMIN_EMAIL = 't@t.com';
const DEFAULT_ADMIN_PASSWORD = 'password123';

/**
 * Read and validate configuration from the environment. REQUIRED vars are
 * STRIPE_TEST_SECRET_KEY, STRIPE_WEBHOOK_SECRET and APP_URL; admin creds fall
 * back to documented test defaults. Returns the missing var names so the
 * caller can print a clear, actionable message and exit nonzero.
 */
function readConfig(env: NodeJS.ProcessEnv): EnvResult {
  const missing: string[] = [];
  const stripeTestSecretKey = env['STRIPE_TEST_SECRET_KEY'] ?? '';
  const stripeWebhookSecret = env['STRIPE_WEBHOOK_SECRET'] ?? '';
  const appUrl = env['APP_URL'] ?? '';

  if (!stripeTestSecretKey) missing.push('STRIPE_TEST_SECRET_KEY');
  if (!stripeWebhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!appUrl) missing.push('APP_URL');

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message:
        `Missing required env: ${missing.join(', ')}.\n` +
        'Set STRIPE_TEST_SECRET_KEY (sk_test_...), STRIPE_WEBHOOK_SECRET (whsec_...), APP_URL ' +
        '(base URL of the running app), and TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD ' +
        '(defaults t@t.com / password123). See docs/billing-lifecycle-test.md.',
    };
  }

  // Guard against accidentally running with a LIVE key.
  if (!stripeTestSecretKey.startsWith('sk_test_')) {
    return {
      ok: false,
      missing: [],
      message:
        'Refusing to run: STRIPE_TEST_SECRET_KEY must be a Stripe TEST key ' +
        `(starts with 'sk_test_'). Got a key ending in ${redact(stripeTestSecretKey)}. ` +
        'Never run this harness against live keys.',
    };
  }

  const config: HarnessConfig = {
    stripeTestSecretKey,
    stripeWebhookSecret,
    appUrl: appUrl.replace(/\/$/, ''),
    adminEmail: env['TEST_ADMIN_EMAIL'] ?? DEFAULT_ADMIN_EMAIL,
    adminPassword: env['TEST_ADMIN_PASSWORD'] ?? DEFAULT_ADMIN_PASSWORD,
    priceStarterMonthly: env['STRIPE_PRICE_STARTER_MONTHLY'],
    priceProMonthly: env['STRIPE_PRICE_PRO_MONTHLY'],
    priceEnterpriseMonthly: env['STRIPE_PRICE_ENTERPRISE_MONTHLY'],
    tenantId: env['TEST_TENANT_ID'],
  };

  return { ok: true, config, missing: [] };
}

// ── HTTP / auth session ────────────────────────────────────────────────────────

/**
 * Holds captured cookies (session + CSRF) so authenticated calls can reuse them,
 * plus the CSRF token value the app expects echoed in the x-csrf-token header
 * (double-submit-cookie pattern; see lib/auth/csrf.ts).
 */
interface AuthSession {
  cookieHeader: string;
  csrfToken: string | null;
}

/** Parse Set-Cookie header values into a single "name=value; name=value" cookie header. */
function collectCookies(setCookies: string[]): { cookieHeader: string; csrfToken: string | null } {
  const jar = new Map<string, string>();
  let csrfToken: string | null = null;
  for (const raw of setCookies) {
    const firstPair = raw.split(';')[0]?.trim();
    if (!firstPair) continue;
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPair.slice(0, eqIdx);
    const value = firstPair.slice(eqIdx + 1);
    jar.set(name, value);
    if (name === 'nucrm_csrf_token') csrfToken = value;
  }
  const cookieHeader = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  return { cookieHeader, csrfToken };
}

/**
 * Read Set-Cookie values from a fetch Response in a runtime-agnostic way.
 * undici (Node 18+) exposes response.headers.getSetCookie().
 */
function getSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/** Authenticate against /api/auth/login and capture session + CSRF cookies. */
async function login(config: HarnessConfig): Promise<AuthSession> {
  const res = await fetch(`${config.appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `${detail} — ${body.error}`;
    } catch {
      // non-JSON error body; keep status only
    }
    throw new Error(`Login failed for ${config.adminEmail}: ${detail}`);
  }

  const { cookieHeader, csrfToken } = collectCookies(getSetCookies(res));
  if (!cookieHeader.includes('nucrm_session')) {
    throw new Error('Login succeeded but no session cookie was set (nucrm_session missing).');
  }
  return { cookieHeader, csrfToken };
}

interface ApiResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

/** Perform an authenticated JSON API call, attaching cookies + CSRF header for mutations. */
async function apiCall(
  config: HarnessConfig,
  session: AuthSession,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const headers: Record<string, string> = { Cookie: session.cookieHeader };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Double-submit-cookie CSRF: mutations must echo the cookie token in the header.
  if (method !== 'GET' && session.csrfToken) headers['x-csrf-token'] = session.csrfToken;

  const res = await fetch(`${config.appUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

// ── Signed-webhook relay ───────────────────────────────────────────────────────

interface WebhookResult {
  status: number;
  body: { received?: boolean; duplicate?: boolean; error?: string } | null;
}

/**
 * Sign a fixture envelope with the webhook secret and POST it to the app's
 * /api/webhooks/stripe endpoint exactly like Stripe would. This lets webhook-
 * driven lifecycle steps run deterministically without a public webhook URL.
 */
async function relayWebhook(
  config: HarnessConfig,
  event: StripeEventEnvelope,
): Promise<WebhookResult> {
  const payload = JSON.stringify(event);
  const signature = signStripeWebhook(payload, config.stripeWebhookSecret);
  const res = await fetch(`${config.appUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  let body: WebhookResult['body'] = null;
  try {
    body = (await res.json()) as WebhookResult['body'];
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ── Helpers to read tenant billing state via API ───────────────────────────────

interface SubscriptionView {
  status?: string;
  planId?: string;
  stripeSubscriptionId?: string | null;
  id?: string;
}

interface PlanView {
  maxContacts?: number | null;
  maxUsers?: number | null;
}

/** Fetch the current subscription + plan snapshot from the tenant billing API. */
async function fetchSubscription(
  config: HarnessConfig,
  session: AuthSession,
): Promise<{ subscription: SubscriptionView | null; plan: PlanView | null; raw: unknown }> {
  const res = await apiCall(config, session, 'GET', '/api/tenant/billing/subscription');
  const data = (res.json as { data?: { subscription?: SubscriptionView; plan?: PlanView } | null })?.data ?? null;
  return {
    subscription: data?.subscription ?? null,
    plan: data?.plan ?? null,
    raw: res.json,
  };
}

// ── Lifecycle driver ───────────────────────────────────────────────────────────

/**
 * Resolve a tenant id + Stripe customer id to drive the lifecycle against.
 * Prefers a real Stripe TEST customer created via lib/stripe (so renewal/test-
 * clock work is possible), tagged with tenant_id metadata. Falls back to a
 * synthetic customer id if Stripe customer creation is unavailable.
 */
async function resolveTenantAndCustomer(
  config: HarnessConfig,
  session: AuthSession,
  checks: Check[],
): Promise<{ tenantId: string; customerId: string; subscriptionId: string }> {
  // Baseline: read current subscription/plan for the authenticated tenant.
  const baseline = await fetchSubscription(config, session);
  checks.push(
    assertTrue(
      'signup/provisioning: tenant billing endpoint reachable',
      baseline.raw !== null,
      'GET /api/tenant/billing/subscription returned no body',
    ),
  );

  const tenantId = config.tenantId ?? baseline.subscription?.id ?? '';
  // Create a Stripe TEST customer bound to this tenant so webhooks that look up
  // tenants by stripeCustomerId resolve, and so renewal via test clocks is possible.
  const { createCustomer } = await import('@/lib/stripe');
  let customerId = `cus_synthetic_${Date.now()}`;
  try {
    const customer = await createCustomer({
      email: config.adminEmail,
      name: 'NuCRM billing harness (TEST)',
      tenantId,
      metadata: { harness: '1477', pm_success: PM_CARD_SUCCESS },
    });
    customerId = customer.id;
    checks.push(assertTrue('plan select: Stripe TEST customer created', Boolean(customer.id)));
  } catch (err) {
    checks.push(
      assertTrue(
        'plan select: Stripe TEST customer created',
        false,
        `createCustomer failed (using synthetic id): ${safeMessage(err)}`,
      ),
    );
  }

  const subscriptionId = `sub_harness_${Date.now()}`;
  return { tenantId, customerId, subscriptionId };
}

/** Run the full ordered lifecycle, appending a Check per step. */
async function runLifecycle(config: HarnessConfig): Promise<Check[]> {
  const checks: Check[] = [];

  // (0) Auth
  const session = await login(config);
  checks.push(assertTrue('auth: logged in and captured session + CSRF cookies', Boolean(session.cookieHeader)));

  const { tenantId, customerId, subscriptionId } = await resolveTenantAndCustomer(config, session, checks);
  const starterPrice = config.priceStarterMonthly;

  // (1)+(2) Plan selection + subscription create → checkout.session.completed → active + planId
  const checkoutEvt = buildCheckoutSessionCompleted({
    tenantId,
    customerId,
    subscriptionId,
    priceId: starterPrice,
  });
  const checkoutRelay = await relayWebhook(config, checkoutEvt);
  checks.push(assertEqual('checkout.session.completed: handler returns 200', checkoutRelay.status, 200));
  checks.push(assertTrue('checkout.session.completed: { received: true }', checkoutRelay.body?.received === true));

  // Idempotency (#1287): re-POST the SAME event id → { duplicate: true }
  const checkoutDup = await relayWebhook(config, checkoutEvt);
  checks.push(assertTrue('checkout.session.completed: duplicate re-POST → { duplicate: true }', checkoutDup.body?.duplicate === true));

  const afterCheckout = await fetchSubscription(config, session);
  checks.push(assertOneOf('checkout: tenant status active', afterCheckout.subscription?.status, ['active']));
  if (starterPrice) {
    checks.push(assertEqual('checkout: planId mapped to starter', afterCheckout.subscription?.planId, 'starter'));
  }

  // (3) Entitlements/limits: plan limits are reflected on the subscription endpoint
  checks.push(
    assertTrue(
      'entitlements: plan limits exposed (maxContacts present)',
      afterCheckout.plan == null || typeof afterCheckout.plan.maxContacts === 'number' || afterCheckout.plan.maxContacts === null,
      'plan object present but maxContacts missing',
    ),
  );

  // (4) Invoice/payment → invoice.payment_succeeded keeps tenant active
  const paidEvt = buildInvoicePaymentSucceeded({
    customerId,
    invoiceId: `in_${Date.now()}_paid`,
    amountPaid: 2900,
  });
  const paidRelay = await relayWebhook(config, paidEvt);
  checks.push(assertEqual('invoice.payment_succeeded: handler returns 200', paidRelay.status, 200));
  const afterPaid = await fetchSubscription(config, session);
  checks.push(assertOneOf('invoice.payment_succeeded: tenant stays active', afterPaid.subscription?.status, ['active']));

  // (4b) Invoice-number uniqueness + monotonicity (#1462)
  await checkInvoiceNumbering(config, session, checks);

  // (5) Renewal — synthetic invoice.payment_succeeded (test-clock advancement is a
  // documented MANUAL step in the runbook; a public webhook is not required here).
  const renewalEvt = buildInvoicePaymentSucceeded({
    customerId,
    invoiceId: `in_${Date.now()}_renewal`,
    amountPaid: 2900,
  });
  const renewalRelay = await relayWebhook(config, renewalEvt);
  checks.push(assertEqual('renewal: synthetic invoice.payment_succeeded processed (200)', renewalRelay.status, 200));
  const afterRenewal = await fetchSubscription(config, session);
  checks.push(assertOneOf('renewal: tenant remains active', afterRenewal.subscription?.status, ['active']));

  // (6) Dunning on failed payment → past_due, then retry cap (#1464)
  const failedEvt = buildInvoicePaymentFailed({
    customerId,
    invoiceId: `in_${Date.now()}_failed`,
    amountPaid: 0,
  });
  const failedRelay = await relayWebhook(config, failedEvt);
  checks.push(assertEqual('invoice.payment_failed: handler returns 200', failedRelay.status, 200));
  const afterFailed = await fetchSubscription(config, session);
  checks.push(assertOneOf('dunning: tenant becomes past_due', afterFailed.subscription?.status, ['past_due']));

  await checkRetryCap(config, session, afterFailed.subscription?.id, checks);

  // (8) #1463 status mapping via customer.subscription.updated
  await checkStatusMapping(config, session, tenantId, starterPrice, checks);

  // (7) #1463 manual-suspension guard: a terminal tenant must NOT be re-activated.
  // Setting a tenant to a terminal status is an owner-only/superadmin action and
  // is documented as a MANUAL step in the runbook, so this guard is asserted
  // structurally (a routine active update after a cancelled state must not resurrect).
  await checkSuspensionGuard(config, session, tenantId, starterPrice, checks);

  // (9) Cancellation/downgrade → customer.subscription.deleted → free
  const deletedEvt = buildSubscriptionDeleted({ tenantId });
  const deletedRelay = await relayWebhook(config, deletedEvt);
  checks.push(assertEqual('customer.subscription.deleted: handler returns 200', deletedRelay.status, 200));
  const afterDeleted = await fetchSubscription(config, session);
  checks.push(assertEqual('cancellation: planId downgraded to free', afterDeleted.subscription?.planId, 'free'));
  checks.push(assertOneOf('cancellation: status active (downgrade, not suspend)', afterDeleted.subscription?.status, ['active']));
  checks.push(
    assertTrue(
      'cancellation: stripeSubscriptionId cleared',
      afterDeleted.subscription?.stripeSubscriptionId == null,
      `expected null stripeSubscriptionId, got ${String(afterDeleted.subscription?.stripeSubscriptionId)}`,
    ),
  );

  return checks;
}

/** #1462: create two invoices, assert INV-##### format, uniqueness, monotonicity. */
async function checkInvoiceNumbering(
  config: HarnessConfig,
  session: AuthSession,
  checks: Check[],
): Promise<void> {
  const body = {
    issue_date: new Date().toISOString().split('T')[0],
    line_items: [{ description: 'Harness item', quantity: 1, unit_price: 10 }],
  };
  const first = await apiCall(config, session, 'POST', '/api/tenant/invoices', body);
  const second = await apiCall(config, session, 'POST', '/api/tenant/invoices', body);
  const num1 = (first.json as { data?: { invoiceNumber?: string } })?.data?.invoiceNumber ?? '';
  const num2 = (second.json as { data?: { invoiceNumber?: string } })?.data?.invoiceNumber ?? '';
  const pattern = /^INV-\d{5}$/;
  checks.push(assertTrue('invoice #1462: first invoiceNumber matches INV-#####', pattern.test(num1), `got '${num1}'`));
  checks.push(assertTrue('invoice #1462: second invoiceNumber matches INV-#####', pattern.test(num2), `got '${num2}'`));
  checks.push(assertTrue('invoice #1462: invoice numbers are unique', num1 !== num2, `both were '${num1}'`));
  const seq1 = Number.parseInt(num1.slice(4), 10);
  const seq2 = Number.parseInt(num2.slice(4), 10);
  checks.push(
    assertTrue(
      'invoice #1462: invoice numbers strictly increasing',
      Number.isFinite(seq1) && Number.isFinite(seq2) && seq2 > seq1,
      `${num1} -> ${num2}`,
    ),
  );
}

/** #1464: retry cap — attemptNumber increments; (maxRetries+1)th call → HTTP 400. */
async function checkRetryCap(
  config: HarnessConfig,
  session: AuthSession,
  subscriptionId: string | undefined,
  checks: Check[],
): Promise<void> {
  if (!subscriptionId) {
    checks.push(
      assertTrue(
        'dunning #1464: retry cap enforced',
        false,
        'no subscription id available from GET subscription; ensure a subscriptions row exists',
      ),
    );
    return;
  }
  const maxRetries = 3;
  let capped = false;
  let lastAttemptNumber = 0;
  let monotonic = true;
  for (let i = 0; i < maxRetries + 1; i++) {
    const res = await apiCall(config, session, 'POST', '/api/tenant/billing/dunning/retry', { subscriptionId });
    if (res.status === 400) {
      const err = (res.json as { error?: string })?.error ?? '';
      capped = err.includes('Maximum retry attempts');
      break;
    }
    const attemptNumber = (res.json as { data?: { attemptNumber?: number } })?.data?.attemptNumber ?? 0;
    if (attemptNumber <= lastAttemptNumber) monotonic = false;
    lastAttemptNumber = attemptNumber;
  }
  checks.push(assertTrue('dunning #1464: attemptNumber increments monotonically', monotonic));
  checks.push(assertTrue(`dunning #1464: cap enforced at ${maxRetries} → HTTP 400 'Maximum retry attempts'`, capped));
}

/** #1463: relay subscription.updated with various statuses, assert mapping. */
async function checkStatusMapping(
  config: HarnessConfig,
  session: AuthSession,
  tenantId: string,
  priceId: string | undefined,
  checks: Check[],
): Promise<void> {
  const cases: Array<{ stripeStatus: string; expected: string[] }> = [
    { stripeStatus: 'past_due', expected: ['past_due'] },
    { stripeStatus: 'incomplete', expected: ['past_due'] },
    { stripeStatus: 'canceled', expected: ['cancelled'] },
  ];
  for (const c of cases) {
    const evt = buildSubscriptionUpdated({ tenantId, status: c.stripeStatus, priceId });
    const relay = await relayWebhook(config, evt);
    checks.push(assertEqual(`#1463 mapping: subscription.updated ${c.stripeStatus} handled (200)`, relay.status, 200));
    const view = await fetchSubscription(config, session);
    checks.push(
      assertOneOf(
        `#1463 mapping: Stripe '${c.stripeStatus}' → NuCRM ${c.expected.join('/')}`,
        view.subscription?.status,
        c.expected,
      ),
    );
  }
}

/**
 * #1463: manual-suspension guard. After a terminal ('canceled' → 'cancelled')
 * status, a routine subscription.updated with status 'active' must NOT resurrect
 * the tenant to active. (Putting a tenant into suspended/deleted is an owner-only
 * action documented as a manual step; here we exercise the cancelled terminal.)
 */
async function checkSuspensionGuard(
  config: HarnessConfig,
  session: AuthSession,
  tenantId: string,
  priceId: string | undefined,
  checks: Check[],
): Promise<void> {
  // Drive tenant into a terminal 'cancelled' state.
  await relayWebhook(config, buildSubscriptionUpdated({ tenantId, status: 'canceled', priceId }));
  const beforeGuard = await fetchSubscription(config, session);
  const wasTerminal = beforeGuard.subscription?.status === 'cancelled';

  // Routine active update — should be ignored for a terminal tenant.
  await relayWebhook(config, buildSubscriptionUpdated({ tenantId, status: 'active', priceId }));
  const afterGuard = await fetchSubscription(config, session);

  checks.push(
    assertTrue(
      '#1463 guard: terminal (cancelled) tenant is NOT re-activated by routine subscription.updated=active',
      !wasTerminal || afterGuard.subscription?.status !== 'active',
      `status after routine active update: ${String(afterGuard.subscription?.status)}`,
    ),
  );
}

// ── Error handling ─────────────────────────────────────────────────────────────

/** Turn an unknown error into a short, non-secret message. */
function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const envResult = readConfig(process.env);
  if (!envResult.ok || !envResult.config) {
    console.error('[billing-harness] Cannot run:');
    console.error(envResult.message ?? 'Invalid configuration.');
    return 1;
  }
  const config = envResult.config;

  // lib/stripe.ts reads STRIPE_SECRET_KEY; point it at the validated TEST key.
  process.env['STRIPE_SECRET_KEY'] = config.stripeTestSecretKey;

  console.log('[billing-harness] #1477 Stripe billing-lifecycle test');
  console.log(`  APP_URL              : ${config.appUrl}`);
  console.log(`  STRIPE_TEST_SECRET   : ${redact(config.stripeTestSecretKey)}`);
  console.log(`  STRIPE_WEBHOOK_SECRET: ${redact(config.stripeWebhookSecret)}`);
  console.log(`  Admin login          : ${config.adminEmail}`);
  console.log(`  TEST payment methods : ${PM_CARD_SUCCESS} (success), ${PM_CARD_FAILURE} / ${CARD_PAN_FAILURE} (failure)`);
  console.log('');

  let checks: Check[];
  try {
    checks = await runLifecycle(config);
  } catch (err) {
    // Convert an unexpected throw into a FAIL check so we still emit a report.
    checks = [
      {
        name: 'lifecycle run',
        pass: false,
        detail: `unexpected error: ${safeMessage(err)}`,
      },
    ];
  }

  console.log('── Results ─────────────────────────────────────────────');
  for (const check of checks) {
    console.log(formatCheck(check));
  }
  const summary = summarize(checks);
  console.log('────────────────────────────────────────────────────────');
  console.log(`Passed: ${summary.passed}  Failed: ${summary.failed}  Total: ${checks.length}`);

  return summary.allPassed ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Last-resort guard so the harness never rejects unhandled.
    console.error(`[billing-harness] Fatal: ${safeMessage(err)}`);
    process.exit(1);
  });

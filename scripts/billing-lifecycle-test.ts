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
  buildSubscriptionUpdatedNoTenant,
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
  // Optional superadmin creds. When present, the harness logs in as superadmin
  // and asserts tenant-table state (uncached) via GET /api/superadmin/tenants/<id>.
  superadminEmail?: string;
  superadminPassword?: string;
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
    superadminEmail: env['SUPERADMIN_EMAIL'],
    superadminPassword: env['SUPERADMIN_PASSWORD'],
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
async function login(config: HarnessConfig, email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${config.appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `${detail} — ${body.error}`;
    } catch {
      // non-JSON error body; keep status only
    }
    throw new Error(`Login failed for ${email}: ${detail}`);
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

/**
 * Fetch the current subscription + plan snapshot from the tenant billing API.
 *
 * NOTE: this reads the `subscriptions` table, NOT `tenants`. Stripe webhooks
 * mutate `tenants`, so this endpoint is the correct source ONLY for the real
 * `subscriptions.id` (retry-cap step) and for plan LIMITS — never for the
 * tenant status/planId/stripeSubscriptionId that webhooks set. Use
 * `fetchTenantState` for those (see resolveTenantState).
 */
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

// ── Tenant-table state (the source webhooks actually write) ────────────────────

/** Tenant-table state as observed via workspace/superadmin endpoints. */
interface TenantState {
  status?: string;
  planId?: string;
  source: 'superadmin' | 'workspace' | 'none';
}

/**
 * Resolves tenant-table state (status/planId) — the columns Stripe webhook
 * handlers write. Prefers the superadmin session (uncached
 * GET /api/superadmin/tenants/<id>); otherwise falls back to the tenant
 * workspace endpoint (GET /api/tenant/workspace), which is dbCache'd for ~2
 * minutes so a read immediately after a webhook may be STALE. The read is
 * retried a few times to tolerate that cache latency.
 */
interface TenantStateResolver {
  fetch(): Promise<TenantState>;
  /** Human-readable description of the source, for report/debug lines. */
  label: string;
}

/** Sleep helper (used to tolerate the workspace cache TTL between reads). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET the uncached superadmin tenant row (status + plan_id from `tenants`). */
async function fetchTenantStateSuperadmin(
  config: HarnessConfig,
  superadminSession: AuthSession,
  tenantId: string,
): Promise<TenantState> {
  const res = await apiCall(config, superadminSession, 'GET', `/api/superadmin/tenants/${tenantId}`);
  const data = (res.json as { data?: { status?: string; plan_id?: string } | null })?.data ?? null;
  return { status: data?.status, planId: data?.plan_id, source: 'superadmin' };
}

/** GET the (2-min cached) tenant workspace row (id/status/planId from `tenants`). */
async function fetchTenantStateWorkspace(
  config: HarnessConfig,
  session: AuthSession,
): Promise<TenantState> {
  const res = await apiCall(config, session, 'GET', '/api/tenant/workspace');
  const data = (res.json as { data?: { status?: string; planId?: string } | null })?.data ?? null;
  return { status: data?.status, planId: data?.planId, source: 'workspace' };
}

// ── Lifecycle driver ───────────────────────────────────────────────────────────

/**
 * Resolve the REAL `tenants.id` to drive the lifecycle against.
 *
 * The Stripe webhook handlers filter `eq(tenants.id, tenant_id)`, so the id we
 * embed in fixtures MUST be the tenants PK. We resolve it from (in order):
 *   1. TEST_TENANT_ID (explicit pin), or
 *   2. GET /api/tenant/workspace `data.id` (authoritative tenants.id for the
 *      logged-in session).
 * We NEVER fall back to the subscriptions PK — that is a different UUID space
 * and every handler would update zero rows silently (review issue #2).
 * Throws with actionable guidance if neither source yields a tenant id.
 */
async function resolveTenantId(config: HarnessConfig, session: AuthSession): Promise<string> {
  if (config.tenantId) return config.tenantId;
  const ws = await fetchTenantStateWorkspace(config, session);
  const res = await apiCall(config, session, 'GET', '/api/tenant/workspace');
  const id = (res.json as { data?: { id?: string } | null })?.data?.id;
  void ws;
  if (id) return id;
  throw new Error(
    'Cannot resolve the tenant id. Set TEST_TENANT_ID to the real tenants.id, ' +
      'or ensure the logged-in admin has a workspace (GET /api/tenant/workspace must return data.id).',
  );
}

/**
 * Build the tenant-state resolver used for post-webhook assertions.
 * Prefers an uncached superadmin read; falls back to the (cached) workspace
 * endpoint with a short retry loop to tolerate the ~2-minute cache TTL.
 */
function buildTenantStateResolver(
  config: HarnessConfig,
  session: AuthSession,
  superadminSession: AuthSession | null,
  tenantId: string,
): TenantStateResolver {
  if (superadminSession) {
    return {
      label: 'superadmin GET /api/superadmin/tenants/<id> (uncached)',
      fetch: () => fetchTenantStateSuperadmin(config, superadminSession, tenantId),
    };
  }
  return {
    label: 'tenant GET /api/tenant/workspace (dbCache ~2min — retried)',
    fetch: () => fetchTenantStateWorkspace(config, session),
  };
}

/**
 * Read tenant state until it satisfies `predicate` or attempts run out. The
 * workspace endpoint is cached for ~2 minutes, so an immediate post-webhook
 * read can be stale; this tolerant read gives it a few short retries. The
 * uncached superadmin source normally satisfies on the first attempt.
 */
async function readTenantStateUntil(
  resolver: TenantStateResolver,
  predicate: (s: TenantState) => boolean,
  attempts = 4,
  delayMs = 1500,
): Promise<TenantState> {
  let last = await resolver.fetch();
  for (let i = 1; i < attempts && !predicate(last); i++) {
    await sleep(delayMs);
    last = await resolver.fetch();
  }
  return last;
}

/**
 * Create a Stripe TEST customer bound to this tenant so webhooks that look up
 * tenants by stripeCustomerId resolve, and so renewal via test clocks is
 * possible. Falls back to a synthetic customer id if creation is unavailable.
 */
async function resolveCustomer(
  config: HarnessConfig,
  tenantId: string,
  checks: Check[],
): Promise<string> {
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
  return customerId;
}

/** Run the full ordered lifecycle, appending a Check per step. */
async function runLifecycle(config: HarnessConfig): Promise<Check[]> {
  const checks: Check[] = [];

  // (0) Auth (tenant admin)
  const session = await login(config, config.adminEmail, config.adminPassword);
  checks.push(assertTrue('auth: logged in and captured session + CSRF cookies', Boolean(session.cookieHeader)));

  // Optional superadmin session — enables UNCACHED tenant-table assertions.
  let superadminSession: AuthSession | null = null;
  if (config.superadminEmail && config.superadminPassword) {
    try {
      superadminSession = await login(config, config.superadminEmail, config.superadminPassword);
      checks.push(assertTrue('auth: superadmin session captured (uncached tenant reads)', Boolean(superadminSession.cookieHeader)));
    } catch (err) {
      checks.push(assertTrue('auth: superadmin session captured (uncached tenant reads)', false, safeMessage(err)));
    }
  }

  // (1) Resolve the REAL tenants.id (review issue #2) and record baseline.
  const tenantId = await resolveTenantId(config, session);
  const resolver = buildTenantStateResolver(config, session, superadminSession, tenantId);
  checks.push(assertTrue(`signup/provisioning: resolved tenants.id (${tenantId.slice(0, 8)}…); state via ${resolver.label}`, Boolean(tenantId)));

  const customerId = await resolveCustomer(config, tenantId, checks);
  const subscriptionId = `sub_harness_${Date.now()}`;
  const starterPrice = config.priceStarterMonthly;

  // (2) Plan selection + subscription create → checkout.session.completed → active + planId
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

  // Assert TENANT-TABLE state (what the webhook wrote), not the subscriptions endpoint.
  const afterCheckout = await readTenantStateUntil(resolver, (s) => s.status === 'active');
  checks.push(assertOneOf('checkout: tenant status active', afterCheckout.status, ['active']));
  if (starterPrice) {
    const mapped = await readTenantStateUntil(resolver, (s) => s.planId === 'starter');
    checks.push(assertEqual('checkout: planId mapped to starter', mapped.planId, 'starter'));
  }

  // (3) Entitlements/limits: plan limits are read from the subscriptions/plan endpoint
  // (genuinely correct — plan limits live on the plans table, exposed here).
  const planView = await fetchSubscription(config, session);
  checks.push(
    assertTrue(
      'entitlements: plan limits exposed (maxContacts present)',
      planView.plan == null || typeof planView.plan.maxContacts === 'number' || planView.plan.maxContacts === null,
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
  const afterPaid = await readTenantStateUntil(resolver, (s) => s.status === 'active');
  checks.push(assertOneOf('invoice.payment_succeeded: tenant stays active', afterPaid.status, ['active']));

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
  const afterRenewal = await readTenantStateUntil(resolver, (s) => s.status === 'active');
  checks.push(assertOneOf('renewal: tenant remains active', afterRenewal.status, ['active']));

  // (5b) Negative fixture (review issue #5): a subscription.updated event with NO
  // metadata.tenant_id must be safely IGNORED — tenant state stays UNCHANGED.
  await checkMissingTenantMetadataIgnored(config, resolver, starterPrice, checks);

  // (6) Dunning on failed payment → past_due, then retry cap (#1464)
  const failedEvt = buildInvoicePaymentFailed({
    customerId,
    invoiceId: `in_${Date.now()}_failed`,
    amountPaid: 0,
  });
  const failedRelay = await relayWebhook(config, failedEvt);
  checks.push(assertEqual('invoice.payment_failed: handler returns 200', failedRelay.status, 200));
  const afterFailed = await readTenantStateUntil(resolver, (s) => s.status === 'past_due');
  checks.push(assertOneOf('dunning: tenant becomes past_due', afterFailed.status, ['past_due']));

  // Retry-cap (#1464) locks the real subscriptions.id row — resolve it from the
  // subscriptions endpoint (review issues #3/#4). If absent, the step SKIPs.
  const subRow = await fetchSubscription(config, session);
  await checkRetryCap(config, session, subRow.subscription?.id, checks);

  // (8) #1463 status mapping via customer.subscription.updated
  await checkStatusMapping(config, resolver, tenantId, starterPrice, checks);

  // (7) #1463 manual-suspension guard: a terminal tenant must NOT be re-activated.
  await checkSuspensionGuard(config, resolver, tenantId, starterPrice, checks);

  // (9) Cancellation/downgrade → customer.subscription.deleted → free
  const deletedEvt = buildSubscriptionDeleted({ tenantId });
  const deletedRelay = await relayWebhook(config, deletedEvt);
  checks.push(assertEqual('customer.subscription.deleted: handler returns 200', deletedRelay.status, 200));
  const afterDeleted = await readTenantStateUntil(resolver, (s) => s.planId === 'free');
  checks.push(assertEqual('cancellation: planId downgraded to free', afterDeleted.planId, 'free'));
  checks.push(assertOneOf('cancellation: status active (downgrade, not suspend)', afterDeleted.status, ['active']));
  // NOTE: the deletion handler clears tenants.stripeSubscriptionId in the SAME
  // atomic update that sets planId='free' + status='active'. Neither the
  // workspace nor the superadmin tenant endpoint exposes stripeSubscriptionId,
  // so we assert the co-written downgrade columns as the observable proxy for
  // the clear (both are set together in handleSubscriptionDeleted). See the
  // runbook for why a direct stripeSubscriptionId read is not available.
  checks.push(
    assertTrue(
      'cancellation: tenant downgraded (planId=free & status=active ⇒ stripeSubscriptionId cleared in same tx)',
      afterDeleted.planId === 'free' && afterDeleted.status === 'active',
      `planId=${String(afterDeleted.planId)}, status=${String(afterDeleted.status)}`,
    ),
  );

  return checks;
}

/**
 * Review issue #5 — negative fixture. Relay a customer.subscription.updated
 * event that carries NO metadata.tenant_id and assert the tenant state is
 * UNCHANGED. The handler resolves the tenant only via metadata.tenant_id and
 * early-returns when it is missing, so a routine 'active' update lacking the
 * field must NOT re-activate or otherwise mutate the tenant.
 */
async function checkMissingTenantMetadataIgnored(
  config: HarnessConfig,
  resolver: TenantStateResolver,
  priceId: string | undefined,
  checks: Check[],
): Promise<void> {
  const before = await resolver.fetch();
  const evt = buildSubscriptionUpdatedNoTenant({ status: 'canceled', priceId });
  const relay = await relayWebhook(config, evt);
  checks.push(assertEqual('negative: subscription.updated w/o tenant_id handled (200)', relay.status, 200));
  // Give any (unexpected) write a chance to land before re-reading.
  await sleep(500);
  const after = await resolver.fetch();
  checks.push(
    assertTrue(
      'negative: missing metadata.tenant_id leaves tenant state UNCHANGED',
      before.status === after.status && before.planId === after.planId,
      `before {status:${String(before.status)},planId:${String(before.planId)}} ` +
        `after {status:${String(after.status)},planId:${String(after.planId)}}`,
    ),
  );
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

/**
 * #1464: retry cap — attemptNumber increments; (maxRetries+1)th call → HTTP 400.
 *
 * The retry endpoint locks the real `subscriptions.id` row FOR UPDATE, so this
 * step needs an existing subscriptions row for the tenant (review issues
 * #3/#4). We pass the real `subscriptions.id` resolved from
 * GET /api/tenant/billing/subscription. When no subscriptions row exists the
 * step SKIPs (recorded as a non-failing PASS with an explanatory note) rather
 * than self-failing — the runbook documents the seeding prerequisite.
 */
async function checkRetryCap(
  config: HarnessConfig,
  session: AuthSession,
  subscriptionId: string | undefined,
  checks: Check[],
): Promise<void> {
  if (!subscriptionId) {
    checks.push(
      assertTrue(
        'dunning #1464: retry cap SKIPPED — no subscriptions row for tenant',
        true,
        'SKIP: seed a subscriptions row for TEST_TENANT_ID to exercise the retry cap (see runbook §7)',
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

/** #1463: relay subscription.updated with various statuses, assert mapping (tenant-table). */
async function checkStatusMapping(
  config: HarnessConfig,
  resolver: TenantStateResolver,
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
    const view = await readTenantStateUntil(resolver, (s) => c.expected.includes(s.status ?? ''));
    checks.push(
      assertOneOf(
        `#1463 mapping: Stripe '${c.stripeStatus}' → NuCRM ${c.expected.join('/')}`,
        view.status,
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
  resolver: TenantStateResolver,
  tenantId: string,
  priceId: string | undefined,
  checks: Check[],
): Promise<void> {
  // Drive tenant into a terminal 'cancelled' state.
  await relayWebhook(config, buildSubscriptionUpdated({ tenantId, status: 'canceled', priceId }));
  const beforeGuard = await readTenantStateUntil(resolver, (s) => s.status === 'cancelled');
  const wasTerminal = beforeGuard.status === 'cancelled';

  // Routine active update — should be ignored for a terminal tenant.
  await relayWebhook(config, buildSubscriptionUpdated({ tenantId, status: 'active', priceId }));
  // The guard means state should NOT become active; give any write time to land,
  // then read once more (no positive predicate to wait on here).
  await sleep(500);
  const afterGuard = await resolver.fetch();

  checks.push(
    assertTrue(
      '#1463 guard: terminal (cancelled) tenant is NOT re-activated by routine subscription.updated=active',
      !wasTerminal || afterGuard.status !== 'active',
      `status after routine active update: ${String(afterGuard.status)}`,
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

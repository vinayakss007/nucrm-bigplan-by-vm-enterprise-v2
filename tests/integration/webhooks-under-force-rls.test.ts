/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3403 — the acceptance test the issue itself asked for: replay a *signed* provider payload
 * through the shipped handler against a FORCE-RLS database, and read the tables back as the
 * owner afterwards.
 *
 * WHY THE UNIT SUITE IS NOT ENOUGH
 * --------------------------------
 * `tests/unit/webhook-billing-tenant-context-3403.test.ts` proves the *shape* — one BEGIN per
 * event, `set_config('app.current_tenant', payload tenant, true)` before every write, the nil
 * actor, no `app.is_super_admin` anywhere. It does that with a recorder, because a recorder is the
 * only way to see the sequence. A recorder cannot prove the consequence: that the row this
 * repository used to answer a **200** over is *actually there* when Postgres is done. Zero-row
 * `UPDATE` is not an error, so every assertion about "the route did not throw" is worth nothing on
 * this defect class — which is the sentence **0100** wrote down for the cron paths and #3403 is the
 * billing paths.
 *
 * So this file does the only thing that can prove it end to end:
 *  - mints a NOSUPERUSER / NOBYPASSRLS role (#2446's technique, as **#3328** uses it) and points
 *    the **application's** pool at it, so the handler's statements are subject to the policies
 *    rather than above them;
 *  - signs payloads with the same HMAC the real provider would (`lib/razorpay.ts:179`,
 *    `lib/stripe.ts:505` are both hex HMAC-SHA256), so nothing about the route's front door is
 *    stubbed;
 *  - reads `tenants` / `subscriptions` back through the *owner* connection, never the one that
 *    wrote — "the handler said ok" is exactly the evidence this bug forged.
 *
 * THE NEGATIVE CONTROL IS A CASE, NOT A HOPE
 * ------------------------------------------
 * `the same UPDATE with no context moves zero rows` runs the statement the base revision ran, on
 * the same connection that just successfully moved a row one case earlier. If this database were
 * not really forced, that case would report 1 and the whole file would be measuring nothing — so
 * `beforeEach` re-asserts `relrowsecurity AND relforcerowsecurity` on `tenants` and the two arms
 * this path depends on are probed in `probeLogin`.
 *
 * IT READS THE SHIPPED POLICY SET, IT DOES NOT INSTALL ONE
 * -------------------------------------------------------
 * `tenants_read_all` / `tenants_authenticated_update` come from 0054 and the FORCE from 0088; CI
 * provisions them with `scripts/apply-rls-ci.mjs` after `db:sync`. Missing arms, an unforced table
 * or a login role that cannot `CREATE ROLE` ⇒ skip with a message naming the command, the way
 * **#3328**'s suite does (#2474: no parallel worker may drop shared catalog objects under this one).
 *
 * Fixtures are documentation-only: `*.example.test` hosts, test-prefixed provider keys, nothing
 * that resembles a credential this repository uses anywhere.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as appSchema from '../../drizzle/schema';

const REQUIRED_ARMS = ['tenants_read_all', 'tenants_authenticated_update'];

/** `tenants` must be RLS-enabled *and* forced, or these cases prove nothing about a policy set. */
async function tenantsForced(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = 'tenants' AND relnamespace = 'public'::regnamespace`,
  );
  const row = rows[0];
  return !!row?.relrowsecurity && !!row?.relforcerowsecurity;
}

async function probeLogin(connectionString: string) {
  if (!connectionString) return { reachable: false, canMintRole: false, armsApplied: false, forced: false };
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await pool.query('SELECT 1');
    const arms = await pool.query<{ policyname: string }>(
      `SELECT DISTINCT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [REQUIRED_ARMS],
    );
    const forced = await tenantsForced(pool);
    const me = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const row = me.rows[0];
    const armsApplied = arms.rowCount === REQUIRED_ARMS.length;
    if (row?.rolsuper || row?.rolbypassrls) {
      return { reachable: true, canMintRole: true, armsApplied, forced };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DO $$ BEGIN CREATE ROLE probe_canary_3403; END $$;');
      await client.query('ROLLBACK');
      return { reachable: true, canMintRole: true, armsApplied, forced };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return { reachable: true, canMintRole: false, armsApplied, forced };
    } finally {
      client.release();
    }
  } catch {
    return { reachable: false, canMintRole: false, armsApplied: false, forced: false };
  } finally {
    await pool.end().catch(() => {});
  }
}

const probe = await probeLogin(process.env.DATABASE_URL ?? '');
const runnable = probe.reachable && probe.canMintRole && probe.armsApplied && probe.forced;
if (probe.reachable && !probe.armsApplied) {
  console.warn(
    '[#3403] skipping: this database does not carry 0054\'s tenants arms. CI provisions them with ' +
    '`node scripts/apply-rls-ci.mjs` after `db:sync`.',
  );
} else if (probe.reachable && !probe.forced) {
  console.warn(
    '[#3403] skipping: `tenants` is not FORCE ROW LEVEL SECURITY here (0088:70), so a zero-row ' +
    'result could mean "the policy refused" or "there is no policy" — the file cannot tell, and ' +
    'neither could the fix.',
  );
} else if (probe.reachable && !probe.canMintRole) {
  console.warn(
    '[#3403] skipping: the login role cannot CREATE ROLE, so no RLS-bound probe exists. The write ' +
    'sequence is covered by tests/unit/webhook-billing-tenant-context-3403.test.ts.',
  );
}
const d = runnable ? describe : describe.skip;

const RUN = randomBytes(4).toString('hex');
const ROLE = `webhook_rls_3403_${RUN}`;
const ROLE_PASSWORD = randomBytes(16).toString('hex');

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const GONE_TENANT = randomUUID();
const SUB_ID = `sub_3403_${RUN}`;
const SUB_ID_B = `sub_3403_b_${RUN}`;
const CUSTOMER_A = `cus_3403_${RUN}`;

const RAZORPAY_SECRET = `whsec_3403_ci_${RUN}`;
const STRIPE_SECRET = `whsec_3403_ci_${RUN}`;

/** `NO_USER_SENTINEL` (`lib/db/rls.ts:64`) — typed out so this file imports no application module. */
const NIL_SENTINEL = '00000000-0000-0000-0000-000000000000';

/** Event ids carry the run id so a redelivery case is about *this* delivery, not a stale ledger row. */
const evt = (kind: string) => `evt_3403_${kind}_${RUN}`;

let admin: Pool;
let adminDb: ReturnType<typeof drizzle<typeof appSchema>>;
let rolePool: Pool;
let originalUrl = '';
const originalEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
  'REDIS_URL', 'LOCK_FAIL_OPEN',
];

type Post = (req: NextRequest) => Promise<Response>;
let razorpayPost: Post;
let stripePost: Post;

/**
 * A provider delivery, signed the way the provider signs it. `lib/razorpay.ts` and `lib/stripe.ts`
 * each implement the HMAC locally (hex, lowercase), so the route's front door is exercised for
 * real — a test that stubbed `verifyWebhookSignature` would not be replaying a payload, it would
 * be replaying a mock.
 */
function signedRazorpay(eventId: string, body: Record<string, unknown>): NextRequest {
  const raw = JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', RAZORPAY_SECRET).update(raw).digest('hex'),
    },
    body: raw,
  });
}

function stripeReq(type: string, eventId: string, object: Record<string, unknown>): NextRequest {
  const raw = JSON.stringify({ id: eventId, object: 'event', type, data: { object } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', STRIPE_SECRET).update(`${ts}.${raw}`).digest('hex');
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${ts},v1=${sig}`,
    },
    body: raw,
  });
}

const tenantRow = async (id: string) => (await admin.query<{
  status: string; plan_id: string; billing_type: string; subscription_id: string | null;
  stripe_subscription_id: string | null;
}>(
  `SELECT status, plan_id, billing_type, subscription_id, stripe_subscription_id
     FROM tenants WHERE id = $1`, [id],
)).rows[0] ?? null;

const subscriptionRow = async (stripeId: string) => (await admin.query<{
  id: string; status: string; tenant_id: string; cancel_at_period_end: boolean | null;
}>(
  `SELECT id, status, tenant_id::text AS tenant_id, cancel_at_period_end
     FROM subscriptions WHERE stripe_subscription_id = $1 AND deleted_at IS NULL`, [stripeId],
)).rows[0] ?? null;

const ledgerRow = async (provider: string, eventId: string) => (await admin.query<{ status: string }>(
  `SELECT status FROM webhook_events WHERE provider = $1 AND event_id = $2`, [provider, eventId],
)).rows[0] ?? null;

d('#3403 a signed provider delivery leaves a row behind on a FORCE-RLS database', () => {
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL as string;
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

    // The Redis lock is deliberately taken OUT of this file's path rather than stubbed.
    // #M3 made `acquireLock` fail CLOSED whenever no client is ready
    // (`lib/cache/index.ts:318` → `refuseUnavailable`), so a Redis-less run answers
    // `{duplicate:true}` at the lock and never reaches the statements this file exists to
    // observe, while a CI run *with* Redis answers the redelivery case from the lock instead
    // of the ledger — two environments, two different things measured. Deleting `REDIS_URL`
    // and failing the lock open pins both to the DB ledger, which `lib/webhooks/idempotency.ts`
    // calls the source of truth (#1908) and which is what a provider retry really meets.
    delete process.env.REDIS_URL;
    process.env.LOCK_FAIL_OPEN = 'true';
    process.env.RAZORPAY_KEY_ID = `rzp_key_ci_${RUN}`;
    process.env.RAZORPAY_KEY_SECRET = `rzp_secret_ci_${RUN}`;
    process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_SECRET;
    process.env.STRIPE_SECRET_KEY = `sk_test_ci_${RUN}`;
    process.env.STRIPE_PUBLISHABLE_KEY = `pk_test_ci_${RUN}`;
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;

    admin = new Pool({ connectionString: originalUrl, connectionTimeoutMillis: 5000 });
    adminDb = drizzle(admin, { schema: appSchema });

    await adminDb.insert(appSchema.tenants).values([
      {
        id: TENANT_A, name: `3403 Workspace ${RUN}`, slug: `3403-a-${RUN}`,
        status: 'trial', planId: 'free', stripeCustomerId: CUSTOMER_A,
      },
      {
        id: TENANT_B, name: `3403 Other ${RUN}`, slug: `3403-b-${RUN}`,
        status: 'trial', planId: 'free',
      },
    ]);
    await adminDb.insert(appSchema.subscriptions).values([
      {
        tenantId: TENANT_A,
        stripeSubscriptionId: SUB_ID,
        stripeCustomerId: CUSTOMER_A,
        status: 'active',
      },
      // #3403's isolation half needs a row that belongs to *someone else*: `subscriptions`
      // is tenant_id-isolated (0031), so B's row is the one a context naming A cannot reach
      // however the handler is written. Without it the assertion would only be proving that
      // this particular payload happened to name one id.
      {
        tenantId: TENANT_B,
        stripeSubscriptionId: SUB_ID_B,
        stripeCustomerId: `cus_3403_b_${RUN}`,
        status: 'active',
      },
    ]);

    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
           CREATE ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS INHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         ELSE
           ALTER ROLE "${ROLE}" NOSUPERUSER NOBYPASSRLS INHERIT LOGIN PASSWORD '${ROLE_PASSWORD}';
         END IF;
       END $$;`,
    );
    await admin.query(`GRANT pg_read_all_data TO "${ROLE}"`);
    await admin.query(`GRANT pg_write_all_data TO "${ROLE}"`);

    const restricted = new URL(originalUrl);
    restricted.username = encodeURIComponent(ROLE);
    restricted.password = encodeURIComponent(ROLE_PASSWORD);
    rolePool = new Pool({ connectionString: restricted.toString(), connectionTimeoutMillis: 5000, max: 3 });
    await rolePool.query('SELECT 1');

    // The application's own pool now runs as a role that is *subject to* the policies.
    process.env.DATABASE_URL = restricted.toString();
    vi.resetModules();
    razorpayPost = (await import('../../app/api/webhooks/razorpay/route')).POST as Post;
    stripePost = (await import('../../app/api/webhooks/stripe/route')).POST as Post;
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    const mark = (label: string, err: unknown) =>
      console.warn(`[#3403] cleanup ${label} failed: ${err instanceof Error ? err.message : String(err)}`);

    // By tenant / by run rather than by the ids each case happened to use: a case that died
    // mid-flow still leaves its ledger claim and its subscription behind otherwise.
    try {
      await admin.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`evt_3403_%_${RUN}`]);
    } catch (err) { mark('webhook_events', err); }
    try {
      await admin.query(`DELETE FROM billing_events WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    } catch (err) { mark('billing_events', err); }
    try {
      await admin.query(`DELETE FROM subscriptions WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    } catch (err) { mark('subscriptions', err); }
    try {
      await admin.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    } catch (err) { mark('tenants', err); }
    try {
      await admin.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN DROP ROLE "${ROLE}"; END IF;
      END $$;`);
    } catch (err) { mark('role', err); }

    await rolePool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  });

  beforeEach(async () => {
    // Re-asserted per case rather than once in `beforeAll`: a suite whose schema stopped being
    // forced mid-run would report the same greens as one that fixed the bug.
    expect(await tenantsForced(admin), '`tenants` must stay FORCE ROW LEVEL SECURITY (0088:70)').toBe(true);
    const arms = await admin.query<{ policyname: string }>(
      `SELECT DISTINCT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
      [REQUIRED_ARMS],
    );
    expect(arms.rowCount, '0054\'s tenants arms must both be installed').toBe(REQUIRED_ARMS.length);
  });

  it('a captured Razorpay subscription activates the tenant it names — the row says so afterwards', async () => {
    const res = await razorpayPost(signedRazorpay(evt('activated'), {
      event: 'subscription.activated',
      payload: { subscription: { entity: {
        id: 'sub_real_3403', plan_id: 'growth',
        notes: { tenant_id: TENANT_A, plan_id: 'growth' },
      } } },
    }));

    expect(res.status, `${JSON.stringify(await res.json().catch(() => null))}`).toBe(200);
    const row = await tenantRow(TENANT_A);
    expect(row?.status).toBe('active');
    expect(row?.billing_type).toBe('razorpay');
    // #1210: Razorpay's `growth` is the app's `pro`, and that mapping is part of what this
    // delivery has to get right — a zero-row write was indistinguishable from a wrong one.
    expect(row?.plan_id).toBe('pro');
    expect(row?.subscription_id).toBe('sub_real_3403');
  });

  it('the same delivery redelivered is a ledger duplicate and changes nothing', async () => {
    // Put the row somewhere the first case never put it, so "still there" means "not re-applied".
    await admin.query(`UPDATE tenants SET status = 'trial', plan_id = 'free' WHERE id = $1`, [TENANT_A]);

    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_dup_3403', notes: { tenant_id: TENANT_A, plan_id: 'scale' } } } },
    };
    const first = await razorpayPost(signedRazorpay(evt('dup'), body));
    expect(first.status).toBe(200);
    expect((await tenantRow(TENANT_A))?.status).toBe('active');

    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TENANT_A]);
    const retry = await razorpayPost(signedRazorpay(evt('dup'), body));
    expect(retry.status).toBe(200);
    expect((await retry.json() as Record<string, unknown>).duplicate).toBe(true);
    expect((await tenantRow(TENANT_A))?.status, 'a deduped redelivery must not re-apply its side effect').toBe('trial');
    expect((await ledgerRow('razorpay', evt('dup')))?.status).toBe('processed');
  });

  it('a payload naming another workspace cannot move this tenant, and does move the one it names', async () => {
    // Tenant B's starting state is set here rather than inherited from an earlier case: a
    // suite whose assertions depend on execution order reports a green that says nothing
    // about the case it claims to run.
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TENANT_B]);
    const before = await tenantRow(TENANT_A);
    const res = await razorpayPost(signedRazorpay(evt('cross'), {
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_cross_3403', notes: { tenant_id: TENANT_B } } } },
    }));
    expect(res.status).toBe(200);

    expect((await tenantRow(TENANT_B))?.status).toBe('past_due');
    const after = await tenantRow(TENANT_A);
    expect(after?.status).toBe(before?.status);
  });

  it('a Stripe subscription.deleted retires the billing row and the tenants row in one commit', async () => {
    const res = await stripePost(stripeReq('customer.subscription.deleted', evt('deleted'), {
      id: SUB_ID, object: 'subscription', customer: CUSTOMER_A, status: 'canceled',
      metadata: { tenant_id: TENANT_A },
    }));

    expect(res.status, `${JSON.stringify(await res.json().catch(() => null))}`).toBe(200);

    // #2228's pair, #2530's atomicity, #3403's context: on the base revision *both* halves moved
    // zero rows and the route still acked.
    const sub = await subscriptionRow(SUB_ID);
    expect(sub?.status, 'the subscriptions row must exist and say canceled').toBe('canceled');
    expect(sub?.cancel_at_period_end).toBe(false);
    const tenant = await tenantRow(TENANT_A);
    expect(tenant?.plan_id).toBe('free');
    expect(tenant?.stripe_subscription_id, 'the stale Stripe id is cleared with the rest').not.toBe(SUB_ID);
  });

  it('a Stripe subscription.updated writes the workspace its metadata names and no other', async () => {
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TENANT_A]);
    // B parked on a value no handler in this file writes, so "still trial" can only mean
    // "the transaction never named it" — not "an earlier case happened to leave it there".
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TENANT_B]);
    const res = await stripePost(stripeReq('customer.subscription.updated', evt('updated'), {
      id: SUB_ID, object: 'subscription', customer: CUSTOMER_A, status: 'trialing',
      cancel_at_period_end: true, metadata: { tenant_id: TENANT_A }, items: { data: [] },
    }));
    expect(res.status, `${JSON.stringify(await res.json().catch(() => null))}`).toBe(200);

    expect((await tenantRow(TENANT_A))?.status, '#1463 maps a trialing subscription to the app\'s active, never to a literal "trialing"').toBe('active');
    const sub = await subscriptionRow(SUB_ID);
    expect(sub?.status, 'subscriptions speaks "canceled"/"active"; the webhook normalises on the way in').toBe('active');
    expect(sub?.cancel_at_period_end).toBe(true);

    // The privilege #3403 refuses is the wide one: `app.is_super_admin='true'` would have
    // opened every policy keyed on the actor, and the next statement on this connection
    // could have named any workspace. Here the transaction carries `app.current_tenant` =
    // the payload's own tenant and the nil actor, and B is untouched.
    expect((await tenantRow(TENANT_B))?.status).toBe('trial');
    expect((await subscriptionRow(SUB_ID_B))?.status, 'B\'s billing row belongs to no statement this event authorises').toBe('active');
  });

  it('an event naming a tenant this database does not have is acked and writes nothing', async () => {
    const res = await razorpayPost(signedRazorpay(evt('gone'), {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_gone_3403', notes: { tenant_id: GONE_TENANT, plan_id: 'growth' } } } },
    }));

    // Retrying cannot conjure the row, so this is the one failure mode that must NOT be a 500 —
    // and it is reported in the logs instead (see the unit suite for the log assertion).
    expect(res.status).toBe(200);
    expect(await tenantRow(GONE_TENANT)).toBeNull();
  });

  it('an event whose tenant_id is not a uuid is refused before a context is opened', async () => {
    const res = await razorpayPost(signedRazorpay(evt('notuuid'), {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_badid_3403', notes: { tenant_id: 'tenant-not-a-uuid', plan_id: 'growth' } } } },
    }));

    // Postgres would answer 22P02 for the `::uuid` cast; that is a 500 the provider retries
    // forever. Refusing the id is the fail-closed half of `billingWebhookTenant`.
    expect(res.status).toBe(200);
    expect((await tenantRow(TENANT_A))?.plan_id).toBe('free');
  });

  it('the negative control: that same UPDATE, on that same connection, with no context, moves zero rows', async () => {
    // This is the statement the base revision ran. It is not an error and returns no rows —
    // which is the entire reason the defect survived: `UPDATE … rowCount = 0 (silent) … every
    // job logged success while changing nothing` (0100). If this reports 1, the schema is not
    // forced and every green above it is measuring nothing.
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TENANT_B]);
    const target = await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [TENANT_B]);
    expect(target.rowCount).toBe(1);

    const client = await rolePool.connect();
    try {
      await client.query('BEGIN');

      // No `set_config` of anything yet: this is what a bare pool checkout looks like, because
      // `lib/db/pool.ts` normalises the GUCs to '' at every checkout.
      const moved = await client.query(
        `UPDATE tenants SET status = 'active' WHERE id = $1`, [TENANT_B],
      );
      expect(moved.rowCount, 'a context-less write must be refused by the policy, not honoured').toBe(0);

      // And the same claim on the tenant-isolated table, where `app.current_tenant` is the
      // predicate: 0031 compares `tenant_id` to the GUC, so a context naming A cannot touch
      // B's billing row even though the actor is non-empty. This is the arm that makes the
      // payload's own workspace load-bearing rather than decorative. `SET LOCAL`, because
      // that is what `withTenantContext` issues (`lib/db/rls.ts:120`).
      const namedA = await client.query(
        `SELECT set_config('app.current_user', $1, true), set_config('app.current_tenant', $2, true)`,
        [NIL_SENTINEL, TENANT_A],
      );
      expect(namedA.rowCount).toBe(1);
      const blocked = await client.query(
        `UPDATE subscriptions SET status = 'paused' WHERE stripe_subscription_id = $1`, [SUB_ID_B],
      );
      expect(blocked.rowCount, 'a context naming A must not reach B\'s subscription').toBe(0);

      // Same statement, context switched to the row's own workspace: it moves. So the zero
      // above is the policy, not a missing row and not a typo in the WHERE clause.
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_B]);
      const allowed = await client.query(
        `UPDATE subscriptions SET status = 'paused' WHERE stripe_subscription_id = $1`, [SUB_ID_B],
      );
      expect(allowed.rowCount, 'the same write under the right workspace must land, or the block proves nothing').toBe(1);

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await client.query('RESET ALL').catch(() => {});
      client.release();
    }

    expect((await tenantRow(TENANT_B))?.status, 'the context-less UPDATE changed nothing').toBe('trial');
    expect((await subscriptionRow(SUB_ID_B))?.status, 'the rolled-back context write changed nothing').toBe('active');
  });
});

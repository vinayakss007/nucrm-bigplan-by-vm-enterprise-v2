/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The workspace a billing callback names for itself (#3403).
 *
 * `POST /api/webhooks/razorpay` and `POST /api/webhooks/stripe` authenticate by HMAC over
 * the raw body, so no session and no `app.*` GUC exists when their handlers run: proxy.ts
 * lists `/api/webhooks` as public, and #1838's guard deliberately hands such files to
 * `skippedAuthenticators` because a signature proves the SENDER and there is no tenant to
 * open with before the first statement. These routes then wrote anyway — `db.update(tenants)`
 * on the bare pool — and `tenants` is FORCE-RLS (0088:70) whose only UPDATE arm,
 * `tenants_authenticated_update` (0054:151-153), opens on
 * `current_setting('app.current_user', true) != ''`. `lib/db/pool.ts` normalises every
 * checkout with that GUC at '', so the arm admitted nothing: the UPDATE matched zero rows,
 * zero rows is not an error, and the route answered `{received:true}` over a payment that
 * never landed. 0100 recorded this exact failure in words for the cron paths.
 *
 * WHY NOT `withSecurityContext`, which the trial-check cron uses for the same table:
 * `app.is_super_admin='true'` opens every workspace to the statement, and here the tenant id
 * arrives from a request body. #3403 says so explicitly, and it is right — a callback that
 * can name any tenant must be able to write only that tenant. So the actor half is
 * `NO_USER_SENTINEL`: non-empty, which is all `tenants_authenticated_update` asks, and
 * matching no `users` row, so every policy keyed on the actor stays closed. `app.current_tenant`
 * is set alongside it because the same transaction writes `subscriptions`, whose 0031
 * isolation arm compares `tenant_id` to that GUC — and it is set to the payload's own
 * workspace, so a payload naming tenant A can move nothing belonging to tenant B.
 *
 * The claim is transaction-local (`SET LOCAL`) by construction: `withTenantContext` opens one
 * transaction, sets both GUCs inside it, and hands the caller that same handle, which is also
 * what keeps #2530's tenants+subscriptions pair committing together.
 *
 * `lib/db/rls.ts` is under the #1843/#422 500-line ratchet, so this sits in its own module the
 * way #2472 split the portal lookup, #3163 the form capture and #3303 the SCIM context.
 */
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import { NO_USER_SENTINEL, withTenantContext } from '@/lib/db/rls';
import type { RlsTransaction } from '@/lib/db/rls';

/** What a callback may set on its own tenant row. */
export type TenantBillingPatch = Partial<typeof tenants.$inferInsert>;

/** `unknown_tenant` is the payload naming a workspace this database does not have. */
export type BillingPatchOutcome = 'applied' | 'unknown_tenant';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The payload's `notes.tenant_id` / `metadata.tenant_id`, accepted only as a uuid.
 *
 * Every policy in this path casts the value (`::uuid`), so a non-uuid does not merely match
 * nothing — handed to Postgres it aborts with `22P02`, the route answers 500, and the provider
 * retries an id that can never name a tenant until the endpoint is disabled. Refusing it here
 * is the fail-closed half: no context, no write, an ack, and a log line.
 */
export function billingWebhookTenant(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return UUID_RE.test(value) ? value : null;
}

/**
 * Run `fn` in one transaction carrying exactly the workspace this callback was told about.
 * A caller that already resolved the id with {@link billingWebhookTenant} keeps the check
 * here too, so no future handler can pass a raw payload string through.
 */
export async function withBillingWebhookContext<T>(
  tenantId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const claimed = billingWebhookTenant(tenantId);
  if (!claimed) {
    throw new Error('[RLS] billing webhook context called with a tenant id that is not a uuid — refusing to open a context that can name no workspace');
  }
  return withTenantContext(claimed, NO_USER_SENTINEL, fn);
}

/**
 * Patch the one tenant row this callback names, and report whether anything moved.
 *
 * `rowCount` is the point of the helper: on the base revision the answer was always 0 and
 * nobody looked. Zero rows now splits two ways. If the row is not there at all — a tenant
 * deleted, a stale id in a subscription created before it — retrying cannot conjure it, so
 * say `unknown_tenant` and let the route log and ack. If the row IS visible and the UPDATE
 * still moved nothing, the context this module opened does not satisfy the policy that
 * should have, which is a bug in this repository: throw, so the provider retries and the
 * error is recorded instead of a silent 200.
 *
 * The existence read is deliberately context-free. `tenants_read_all` (0054:147) is
 * `USING (true)`, so a callback may always ask whether a tenant exists — it is the write
 * that needs to be invited in.
 */
export async function applyTenantBillingPatch(
  tx: RlsTransaction,
  tenantId: string,
  patch: TenantBillingPatch,
): Promise<BillingPatchOutcome> {
  const result = await tx
    .update(tenants)
    .set(patch)
    .where(eq(tenants.id, tenantId));

  const moved = (result as { rowCount?: number | null }).rowCount ?? 0;
  if (moved > 0) return 'applied';

  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true },
  });
  if (!existing) return 'unknown_tenant';

  throw new Error(
    `[RLS] billing webhook patch matched 0 rows for tenant ${tenantId} although the row is visible — ` +
    `the transaction's context does not satisfy tenants' UPDATE policy (0054:151)`,
  );
}

/** What {@link createBillingWebhookReporter} returns: the payload-side decisions, pre-named. */
export interface BillingWebhookReporter {
  /** The payload's tenant id if it can name a workspace, `null` (and logged) if it cannot. */
  eventTenant(raw: string | null | undefined, label: string): string | null;
  /** Record an `unknown_tenant` outcome; returns the outcome, so it wraps a patch call inline. */
  report(tenantId: string, label: string, outcome: BillingPatchOutcome): BillingPatchOutcome;
  /** {@link withBillingWebhookContext} + {@link applyTenantBillingPatch} + {@link report}. */
  patchTenant(tenantId: string, patch: TenantBillingPatch, label: string): Promise<BillingPatchOutcome>;
}

/**
 * Bind this module's three verbs to one provider's log names.
 *
 * Both billing callbacks need exactly these — validate the id the payload carries, write under
 * the workspace it names, and say out loud when the write had nothing to write — and neither
 * should have its own copy of the failure semantics. The base revision had four `db.update(tenants)`
 * in Razorpay and four in Stripe, each treating "0 rows" as success; the copies are gone, so the
 * one place that decides what a miss means is here, and the difference between the two providers is
 * two strings.
 *
 * `provider` is the log prefix (`'[Stripe]'`), `source` the `logError` context
 * (`'webhooks/stripe'`), which is also what `tests/unit/webhook-billing-tenant-context-3403.test.ts`
 * matches a report on.
 */
export function createBillingWebhookReporter(opts: {
  provider: string;
  source: string;
}): BillingWebhookReporter {
  const { provider, source } = opts;

  const report: BillingWebhookReporter['report'] = (tenantId, label, outcome) => {
    if (outcome === 'unknown_tenant') {
      // The id came from the provider's own payload, so a retry can never conjure the row —
      // acking is right. It is still a payment that was not recorded, so it is shouted about.
      void logError({
        error: new Error(`${provider} ${label}: tenant ${tenantId} is not in this database, so nothing was written`),
        context: `${source} unrecorded billing event`,
        level: 'error',
        metadata: { tenantId, label },
      });
    }
    return outcome;
  };

  return {
    eventTenant(raw, label) {
      const tenantId = billingWebhookTenant(raw);
      if (!tenantId) {
        void logError({
          error: `${label}: no usable tenant_id in the payload`,
          context: `${source} unusable tenant_id`,
          level: 'warning',
        });
      }
      return tenantId;
    },
    report,
    async patchTenant(tenantId, patch, label) {
      return report(
        tenantId,
        label,
        await withBillingWebhookContext(tenantId, (tx) => applyTenantBillingPatch(tx, tenantId, patch)),
      );
    },
  };
}

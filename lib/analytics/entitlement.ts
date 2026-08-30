/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Server-side entitlement resolver.
 *
 * Answers "is this tenant a paying customer, and on what plan?" from the
 * authoritative tenant record — NEVER from a cookie or client payload. A
 * client that claims `plan=enterprise` cannot influence this; the values are
 * read from the DB keyed off the server-verified tenantId.
 *
 * "Paid" is true when ANY of the following hold:
 *   - planId is set and is not the free plan, AND status is not cancelled, OR
 *   - billingType is 'paid'/'subscription', OR
 *   - there is an active Stripe subscription id, OR
 *   - a manual paid-until date is set and still in the future.
 */
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface Entitlement {
  tenantId: string;
  planId: string | null;
  isPaid: boolean;
}

const FREE_PLAN_IDS = new Set(['free', 'trial', 'trialing', '']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'suspended', 'expired']);

/**
 * Resolve entitlement for a tenant. Returns a safe free/unpaid default if the
 * tenant is missing or the lookup fails — analytics must never break on this.
 */
export async function resolveEntitlement(tenantId: string): Promise<Entitlement> {
  const fallback: Entitlement = { tenantId, planId: null, isPaid: false };
  if (!tenantId) return fallback;

  try {
    const [row] = await db
      .select({
        planId: tenants.planId,
        status: tenants.status,
        billingType: tenants.billingType,
        manualPaidUntil: tenants.manualPaidUntil,
        stripeSubscriptionId: tenants.stripeSubscriptionId,
        subscriptionId: tenants.subscriptionId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!row) return fallback;

    const planId = row.planId ?? null;
    const status = (row.status ?? '').toLowerCase();
    const billingType = (row.billingType ?? '').toLowerCase();
    const cancelled = CANCELLED_STATUSES.has(status);

    const hasPaidPlan =
      !!planId && !FREE_PLAN_IDS.has(planId.toLowerCase()) && !cancelled;
    const hasPaidBilling =
      (billingType === 'paid' || billingType === 'subscription') && !cancelled;
    const hasStripeSub =
      !!(row.stripeSubscriptionId || row.subscriptionId) && !cancelled;
    const hasManualPaid =
      !!row.manualPaidUntil && new Date(row.manualPaidUntil) > new Date();

    const isPaid =
      hasPaidPlan || hasPaidBilling || hasStripeSub || hasManualPaid;

    return { tenantId, planId, isPaid };
  } catch (err) {
    console.error('[analytics] resolveEntitlement failed:', err);
    return fallback;
  }
}

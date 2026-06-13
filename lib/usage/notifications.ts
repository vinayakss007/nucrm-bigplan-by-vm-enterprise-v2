/**
 * Usage Threshold Notifications
 *
 * Checks tenant usage against plan limits and creates notifications
 * when reaching 80%, 90%, and 100% thresholds. Helps tenants proactively
 * manage their usage and upgrade before hitting hard limits.
 */
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { notifications } from '@/drizzle/schema/core';
import { tenantMembers } from '@/drizzle/schema/core';
import { planLimits } from '@/drizzle/schema/usage';
import { eq, and } from 'drizzle-orm';

interface ThresholdCheck {
  resource: string;
  label: string;
  current: number;
  limit: number;
  percentage: number;
}

const THRESHOLDS = [100, 90, 80] as const;

/**
 * Check usage thresholds for a tenant and create notifications
 * for any resources that have crossed 80%, 90%, or 100%.
 */
export async function checkThresholds(tenantId: string): Promise<void> {
  try {
    // Get tenant info
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        planId: true,
        currentUsers: true,
        currentContacts: true,
        currentDeals: true,
        storageUsedBytes: true,
        ownerId: true,
      },
    });

    if (!tenant) return;

    // Get plan limits
    const limits = await db.query.planLimits.findFirst({
      where: eq(planLimits.planId, tenant.planId),
    });

    if (!limits) return; // No limits configured

    // Build list of resources to check
    const checks: ThresholdCheck[] = [];

    if (limits.maxUsers && tenant.currentUsers) {
      const pct = Math.round((tenant.currentUsers / limits.maxUsers) * 100);
      checks.push({
        resource: 'users',
        label: 'Users',
        current: tenant.currentUsers,
        limit: limits.maxUsers,
        percentage: pct,
      });
    }

    if (limits.maxContacts && tenant.currentContacts) {
      const pct = Math.round((tenant.currentContacts / limits.maxContacts) * 100);
      checks.push({
        resource: 'contacts',
        label: 'Contacts',
        current: tenant.currentContacts,
        limit: limits.maxContacts,
        percentage: pct,
      });
    }

    if (limits.maxDeals && tenant.currentDeals) {
      const pct = Math.round((tenant.currentDeals / limits.maxDeals) * 100);
      checks.push({
        resource: 'deals',
        label: 'Deals',
        current: tenant.currentDeals,
        limit: limits.maxDeals,
        percentage: pct,
      });
    }

    if (limits.maxStorageBytes && tenant.storageUsedBytes) {
      const pct = Math.round((tenant.storageUsedBytes / limits.maxStorageBytes) * 100);
      checks.push({
        resource: 'storage',
        label: 'Storage',
        current: tenant.storageUsedBytes,
        limit: limits.maxStorageBytes,
        percentage: pct,
      });
    }

    // Find admin users to notify
    const adminMembers = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.roleSlug, 'admin')
        )
      );

    if (adminMembers.length === 0 && tenant.ownerId) {
      adminMembers.push({ userId: tenant.ownerId });
    }

    // Create notifications for crossed thresholds
    for (const check of checks) {
      for (const threshold of THRESHOLDS) {
        if (check.percentage >= threshold) {
          const title =
            threshold === 100
              ? `${check.label} limit reached (${check.current}/${check.limit})`
              : `${check.label} usage at ${threshold}% (${check.current}/${check.limit})`;

          const body =
            threshold === 100
              ? `You have reached your ${check.label.toLowerCase()} limit. Upgrade your plan to continue adding more.`
              : `You are approaching your ${check.label.toLowerCase()} limit. Consider upgrading your plan.`;

          const type = threshold === 100 ? 'limit_warning' : 'system';

          for (const member of adminMembers) {
            await db
              .insert(notifications)
              .values({
                userId: member.userId,
                tenantId,
                type,
                title,
                body,
                link: '/tenant/settings/billing',
                metadata: {
                  resource: check.resource,
                  threshold,
                  current: check.current,
                  limit: check.limit,
                  percentage: check.percentage,
                },
              })
              .onConflictDoNothing()
              .catch((e) => {
                console.warn('[Usage] Failed to create threshold notification', e);
              });
          }

          // Only notify for the highest crossed threshold
          break;
        }
      }
    }
  } catch (error) {
    console.error('[usage/notifications] checkThresholds error:', error);
  }
}

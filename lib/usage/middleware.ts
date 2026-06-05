/**
 * Usage Limit Middleware
 *
 * Provides middleware functions to check usage limits before
 * allowing API operations. Returns 429 (Too Many Requests) when
 * a tenant or user has exceeded their plan limits.
 */
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { userUsage, planLimits } from '@/drizzle/schema/usage';
import { tenants } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';

/**
 * Check whether the user has exceeded their daily API call limit.
 * Returns null if within limits, or a 429 NextResponse if exceeded.
 */
export async function checkUserLimit(
  tenantId: string,
  userId: string
): Promise<NextResponse | null> {
  try {
    // Get the tenant's plan
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { planId: true },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    // Get plan limits
    const limits = await db.query.planLimits.findFirst({
      where: eq(planLimits.planId, tenant.planId),
    });

    // If no plan limits configured, allow (no enforcement)
    if (!limits || !limits.maxApiCallsPerDay) {
      return null;
    }

    // Get user's current usage for today
    const usage = await db.query.userUsage.findFirst({
      where: and(
        eq(userUsage.tenantId, tenantId),
        eq(userUsage.userId, userId)
      ),
      columns: { apiCallsToday: true, apiCallsDate: true },
    });

    // No usage record yet means they are within limits
    if (!usage) {
      return null;
    }

    // Check if the date has rolled over
    const today = new Date().toISOString().split('T')[0];
    const usageDate = usage.apiCallsDate ? String(usage.apiCallsDate) : null;
    if (usageDate !== today) {
      return null; // Counter is stale, effectively 0
    }

    const currentCalls = usage.apiCallsToday ?? 0;
    if (currentCalls >= limits.maxApiCallsPerDay) {
      return NextResponse.json(
        {
          error: 'API rate limit exceeded for today. Please try again tomorrow or upgrade your plan.',
          limit: limits.maxApiCallsPerDay,
          current: currentCalls,
          resets: 'midnight UTC',
        },
        { status: 429 }
      );
    }

    return null;
  } catch (error) {
    console.error('[usage/middleware] checkUserLimit error:', error);
    // On error, allow the request (fail open for availability)
    return null;
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, automations, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/onboarding/progress
 * Returns which onboarding steps the tenant has completed.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tid = ctx.tenantId;
    const completed: string[] = [];

    // Check: has at least 1 contact
    const [contactCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tid), sql`${contacts.deletedAt} IS NULL`));
    if ((contactCount?.count ?? 0) > 0) completed.push('contact');

    // Check: has at least 1 deal
    const [dealCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.tenantId, tid), sql`${deals.deletedAt} IS NULL`));
    if ((dealCount?.count ?? 0) > 0) completed.push('deal');

    // Check: has email configured (check if any integration type contains 'email')
    // Simplified: mark as done if environment has RESEND_API_KEY or SMTP_HOST
    if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
      completed.push('email');
    }

    // Check: has at least 1 automation
    const [autoCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(automations)
      .where(eq(automations.tenantId, tid));
    if ((autoCount?.count ?? 0) > 0) completed.push('automation');

    // Check: has more than 1 active member (invited someone)
    const [memberCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active')));
    if ((memberCount?.count ?? 0) > 1) completed.push('team');

    return NextResponse.json({ completed, total: 5 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

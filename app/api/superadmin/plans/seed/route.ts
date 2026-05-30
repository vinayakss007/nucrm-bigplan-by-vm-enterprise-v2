import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
import { PLAN_DEFINITIONS } from '@/lib/plans/plan-definitions';

/**
 * POST /api/superadmin/plans/seed
 * Upserts the 4 canonical plan tiers into the plans table.
 * Super admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const results = [];

    for (const plan of PLAN_DEFINITIONS) {
      const [row] = await db
        .insert(plans)
        .values({
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          description: plan.description,
          priceMonthly: plan.priceMonthly.toString(),
          priceYearly: plan.priceYearly.toString(),
          priceCents: plan.priceMonthly * 100,
          price: plan.priceMonthly.toString(),
          maxUsers: plan.maxUsers,
          maxContacts: plan.maxContacts,
          maxDeals: plan.maxDeals,
          maxStorageGb: plan.maxStorageGb.toString(),
          maxAutomations: plan.maxAutomations,
          maxForms: plan.maxForms,
          maxApiCallsDay: plan.maxApiCallsDay,
          features: plan.features,
          sortOrder: plan.sortOrder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: plans.id,
          set: {
            name: sql`EXCLUDED.name`,
            slug: sql`EXCLUDED.slug`,
            description: sql`EXCLUDED.description`,
            priceMonthly: sql`EXCLUDED.price_monthly`,
            priceYearly: sql`EXCLUDED.price_yearly`,
            priceCents: sql`EXCLUDED.price_cents`,
            price: sql`EXCLUDED.price`,
            maxUsers: sql`EXCLUDED.max_users`,
            maxContacts: sql`EXCLUDED.max_contacts`,
            maxDeals: sql`EXCLUDED.max_deals`,
            maxStorageGb: sql`EXCLUDED.max_storage_gb`,
            maxAutomations: sql`EXCLUDED.max_automations`,
            maxForms: sql`EXCLUDED.max_forms`,
            maxApiCallsDay: sql`EXCLUDED.max_api_calls_day`,
            features: sql`EXCLUDED.features`,
            sortOrder: sql`EXCLUDED.sort_order`,
            isActive: sql`EXCLUDED.is_active`,
            updatedAt: new Date(),
          },
        })
        .returning();

      results.push(row);
    }

    return NextResponse.json({
      message: `Successfully seeded ${results.length} plans`,
      data: results,
    });
  } catch (err: any) {
    console.error('[superadmin/plans/seed POST]', err);
    return apiError(err);
  }
}

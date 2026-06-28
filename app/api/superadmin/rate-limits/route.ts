import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans, users, systemSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const RATE_LIMIT_ENDPOINTS = [
  { key: 'api', label: 'API Requests', window: 60, windowLabel: 'per minute' },
  { key: 'auth', label: 'Auth Requests', window: 60, windowLabel: 'per minute' },
  { key: 'contacts', label: 'Contacts CRUD', window: 60, windowLabel: 'per minute' },
  { key: 'deals', label: 'Deals CRUD', window: 60, windowLabel: 'per minute' },
  { key: 'export', label: 'Data Export', window: 3600, windowLabel: 'per hour' },
  { key: 'import', label: 'Data Import', window: 3600, windowLabel: 'per hour' },
  { key: 'ai', label: 'AI Features', window: 3600, windowLabel: 'per hour' },
  { key: 'webhook', label: 'Webhooks', window: 3600, windowLabel: 'per hour' },
  { key: 'passwordReset', label: 'Password Reset', window: 3600, windowLabel: 'per hour' },
  { key: 'emailVerification', label: 'Email Verification', window: 3600, windowLabel: 'per hour' },
  { key: 'bulk', label: 'Bulk Operations', window: 3600, windowLabel: 'per hour' },
];

export async function GET(_request: NextRequest) {
  try {
    const ctx = await requireAuth(_request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Get global defaults from system_settings
    let globalDefaults: Record<string, number> = {};
    try {
      const setting = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, 'global_rate_limits'),
        columns: { value: true },
      });
      if (setting?.value) {
        globalDefaults = typeof setting.value === 'string'
          ? JSON.parse(setting.value)
          : (setting.value as Record<string, number>);
      }
    } catch {
      // Empty defaults
    }

    // Get all plans
    const allPlans = await db.query.plans.findMany({
      columns: { id: true, name: true, slug: true, rateLimitConfig: true },
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    });

    // Get super admins
    const superAdmins = await db.query.users.findMany({
      where: eq(users.isSuperAdmin, true),
      columns: { id: true, email: true, fullName: true, unlimitedRateLimit: true },
    });

    return NextResponse.json({
      data: {
        globalDefaults,
        plans: allPlans.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          rateLimits: p.rateLimitConfig || {},
        })),
        superAdmins: superAdmins.map(u => ({
          id: u.id,
          email: u.email,
          name: u.fullName,
          unlimitedRateLimit: u.unlimitedRateLimit || false,
        })),
        endpoints: RATE_LIMIT_ENDPOINTS,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { action } = body;

    if (action === 'update_global') {
      const { rateLimits } = body;
      if (!rateLimits || typeof rateLimits !== 'object') {
        return NextResponse.json({ error: 'rateLimits object required' }, { status: 400 });
      }

      await db
        .insert(systemSettings)
        .values({
          key: 'global_rate_limits',
          value: JSON.stringify(rateLimits),
          tenantId: null,
        })
        .onConflictDoUpdate({
          target: [systemSettings.key, systemSettings.tenantId],
          set: { value: JSON.stringify(rateLimits), updatedAt: new Date() },
        });

      return NextResponse.json({ ok: true, message: 'Global rate limits updated' });
    }

    if (action === 'update_plan_limits') {
      const { planId, rateLimits } = body;
      if (!planId || !rateLimits) {
        return NextResponse.json({ error: 'planId and rateLimits required' }, { status: 400 });
      }

      await db.update(plans)
        .set({ rateLimitConfig: rateLimits, updatedAt: new Date() })
        .where(eq(plans.id, planId));

      return NextResponse.json({ ok: true, message: `Rate limits updated for plan ${planId}` });
    }

    if (action === 'toggle_super_admin_unlimited') {
      const { userId, unlimited } = body;
      if (!userId || typeof unlimited !== 'boolean') {
        return NextResponse.json({ error: 'userId and unlimited required' }, { status: 400 });
      }

      await db.update(users)
        .set({ unlimitedRateLimit: unlimited, updatedAt: new Date() })
        .where(eq(users.id, userId));

      return NextResponse.json({ ok: true, message: `Unlimited rate limit ${unlimited ? 'enabled' : 'disabled'} for user ${userId}` });
    }

    if (action === 'reset_to_defaults') {
      const { planId } = body;
      if (!planId) {
        return NextResponse.json({ error: 'planId required' }, { status: 400 });
      }

      // Reset to empty object so plan uses global defaults
      await db.update(plans)
        .set({ rateLimitConfig: {}, updatedAt: new Date() })
        .where(eq(plans.id, planId));

      return NextResponse.json({ ok: true, message: `Plan ${planId} reset to use global defaults` });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}

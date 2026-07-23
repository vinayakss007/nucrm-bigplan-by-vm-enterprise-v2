import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans, users, systemSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { updateRateLimitsSchema } from '@/lib/api/schemas';

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
    const parsed = validateBody(updateRateLimitsSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    if (parsed.data.action === 'update_global') {
      await db
        .insert(systemSettings)
        .values({
          key: 'global_rate_limits',
          value: JSON.stringify(parsed.data.rateLimits),
        })
        .onConflictDoUpdate({
          target: [systemSettings.key],
          set: { value: JSON.stringify(parsed.data.rateLimits), updatedAt: new Date() },
        });

      return NextResponse.json({ ok: true, message: 'Global rate limits updated' });
    }

    if (parsed.data.action === 'update_plan_limits') {
      await db.update(plans)
        .set({ rateLimitConfig: parsed.data.rateLimits, updatedAt: new Date() })
        .where(eq(plans.id, parsed.data.planId));

      return NextResponse.json({ ok: true, message: `Rate limits updated for plan ${parsed.data.planId}` });
    }

    if (parsed.data.action === 'toggle_super_admin_unlimited') {
      await db.update(users)
        .set({ unlimitedRateLimit: parsed.data.unlimited, updatedAt: new Date() })
        .where(eq(users.id, parsed.data.userId));

      return NextResponse.json({ ok: true, message: `Unlimited rate limit ${parsed.data.unlimited ? 'enabled' : 'disabled'} for user ${parsed.data.userId}` });
    }

    if (parsed.data.action === 'reset_to_defaults') {
      await db.update(plans)
        .set({ rateLimitConfig: {}, updatedAt: new Date() })
        .where(eq(plans.id, parsed.data.planId));

      return NextResponse.json({ ok: true, message: `Plan ${parsed.data.planId} reset to use global defaults` });
    }
  } catch (err) {
    return apiError(err);
  }
}

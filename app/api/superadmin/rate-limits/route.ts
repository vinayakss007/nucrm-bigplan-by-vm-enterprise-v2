import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans, users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

const RATE_LIMIT_ENDPOINTS = [
  { key: 'api', label: 'API Requests', default: 60, window: 'per minute', desc: 'General API endpoints' },
  { key: 'auth', label: 'Auth Requests', default: 5, window: 'per minute', desc: 'Login, signup, password reset' },
  { key: 'contacts', label: 'Contacts CRUD', default: 30, window: 'per minute', desc: 'Contact create/update/delete' },
  { key: 'deals', label: 'Deals CRUD', default: 30, window: 'per minute', desc: 'Deal create/update/delete' },
  { key: 'export', label: 'Data Export', default: 10, window: 'per hour', desc: 'CSV/Excel exports' },
  { key: 'import', label: 'Data Import', default: 5, window: 'per hour', desc: 'Bulk data imports' },
  { key: 'ai', label: 'AI Features', default: 30, window: 'per hour', desc: 'AI scoring, suggestions' },
  { key: 'webhook', label: 'Webhooks', default: 1000, window: 'per hour', desc: 'Inbound webhook calls' },
  { key: 'passwordReset', label: 'Password Reset', default: 3, window: 'per hour', desc: 'Password reset requests' },
  { key: 'emailVerification', label: 'Email Verification', default: 10, window: 'per hour', desc: 'Email verification links' },
  { key: 'bulk', label: 'Bulk Operations', default: 5, window: 'per hour', desc: 'Bulk update/delete' },
];

export async function GET(_request: NextRequest) {
  try {
    const ctx = await requireAuth(_request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const allPlans = await db.query.plans.findMany({
      columns: { id: true, name: true, slug: true, rateLimitConfig: true },
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    });

    const superAdmins = await db.query.users.findMany({
      where: eq(users.isSuperAdmin, true),
      columns: { id: true, email: true, fullName: true, unlimitedRateLimit: true },
    });

    return NextResponse.json({
      data: {
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

      const defaultConfig = Object.fromEntries(
        RATE_LIMIT_ENDPOINTS.map(e => [e.key, e.default])
      );

      await db.update(plans)
        .set({ rateLimitConfig: defaultConfig, updatedAt: new Date() })
        .where(eq(plans.id, planId));

      return NextResponse.json({ ok: true, message: `Rate limits reset to defaults for plan ${planId}` });
    }

    if (action === 'update_global') {
      const { rateLimits } = body;
      if (!rateLimits) {
        return NextResponse.json({ error: 'rateLimits required' }, { status: 400 });
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(sql`system_settings`)
          .values({
            key: 'global_rate_limits',
            value: JSON.stringify(rateLimits),
            tenantId: null,
          })
          .onConflictDoUpdate({
            target: [sql`key`, sql`tenant_id`],
            set: { value: JSON.stringify(rateLimits), updatedAt: new Date() },
          });
      });

      return NextResponse.json({ ok: true, message: 'Global rate limits updated' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}

import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantAiCredits } from '@/drizzle/schema/ai';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { allocateCredits, getCreditBalance, getAggregatedUsage, getCreditHistory } from '@/lib/ai/credits';

const allocateSchema = z.object({
  action: z.enum(['allocate', 'topup', 'suspend', 'reactivate', 'set_cap']),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Super Admin AI Credits API
 *
 * Manages centralized AI credit allocations for tenants.
 * Two offering types:
 *   1. Centralized: Super admin allocates tokens, users consume from pool
 *   2. Personal: Users add their own API keys (tracked via ai_activity only)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');
    const history = searchParams.get('history');
    const limit = parseInt(searchParams.get('limit') ?? '50');

    // Single tenant balance
    if (tenantId) {
      const balance = await getCreditBalance(tenantId);
      const historyData = history === 'true' ? await getCreditHistory(tenantId, limit) : [];
      return NextResponse.json({
        success: true,
        data: { balance, history: historyData },
      });
    }

    // Aggregated usage across all tenants
    const usage = await getAggregatedUsage();
    return NextResponse.json({
      success: true,
      data: { tenants: usage },
    });
  } catch (err: unknown) {
    console.error('[api/ai-credits] GET error:', (err as Error).message);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const raw = await request.json();
    const parsed = validateBody(allocateSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { action, data } = parsed.data;

    // ACTION: Allocate credits to a tenant
    if (action === 'allocate') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;
      const tokens = d['tokens'] as number;
      const cost_cents = d['cost_cents'] as number | undefined;
      const notes = d['notes'] as string | undefined;

      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
      if (!tokens || tokens <= 0) return NextResponse.json({ error: 'tokens must be positive' }, { status: 400 });

      const balance = await allocateCredits({
        tenantId: tenant_id,
        allocatedBy: ctx.userId,
        tokens,
        costCents: cost_cents,
        notes,
      });

      return NextResponse.json({
        success: true,
        message: `Allocated ${tokens.toLocaleString()} tokens to tenant`,
        data: { balance },
      });
    }

    // ACTION: Top up additional credits
    if (action === 'topup') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;
      const tokens = d['tokens'] as number;
      const cost_cents = d['cost_cents'] as number | undefined;
      const notes = d['notes'] as string | undefined;

      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
      if (!tokens || tokens <= 0) return NextResponse.json({ error: 'tokens must be positive' }, { status: 400 });

      const balance = await allocateCredits({
        tenantId: tenant_id,
        allocatedBy: ctx.userId,
        tokens,
        costCents: cost_cents,
        notes: notes ?? 'Top-up allocation',
      });

      return NextResponse.json({
        success: true,
        message: `Topped up ${tokens.toLocaleString()} tokens`,
        data: { balance },
      });
    }

    // ACTION: Suspend tenant AI access
    if (action === 'suspend') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;

      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });

      const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      await db
        .update(tenantAiCredits)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(and(
          eq(tenantAiCredits.tenantId, tenant_id),
          eq(tenantAiCredits.billingPeriod, period),
        ));

      return NextResponse.json({ success: true, message: 'Tenant AI access suspended' });
    }

    // ACTION: Reactivate tenant AI access
    if (action === 'reactivate') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;

      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });

      const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      await db
        .update(tenantAiCredits)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(
          eq(tenantAiCredits.tenantId, tenant_id),
          eq(tenantAiCredits.billingPeriod, period),
        ));

      return NextResponse.json({ success: true, message: 'Tenant AI access reactivated' });
    }

    // ACTION: Set hard/soft cap
    if (action === 'set_cap') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;
      const hard_cap = d['hard_cap_enabled'] as boolean | undefined;
      const soft_cap_pct = d['soft_cap_pct'] as number | undefined;

      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });

      const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      await db
        .update(tenantAiCredits)
        .set({
          hardCapEnabled: hard_cap ?? true,
          softCapPct: soft_cap_pct ?? 80,
          updatedAt: new Date(),
        })
        .where(and(
          eq(tenantAiCredits.tenantId, tenant_id),
          eq(tenantAiCredits.billingPeriod, period),
        ));

      return NextResponse.json({ success: true, message: 'Updated credit caps' });
    }

    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    console.error('[api/ai-credits] POST error:', (err as Error).message);
    return apiError(err);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, planLimits } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';

const LIMIT_FIELDS = [
  'maxUsers', 'maxContacts', 'maxDeals', 'maxStorageBytes',
  'maxApiCallsPerDay', 'maxAiTokensPerDay', 'maxEmailsPerDay',
  'maxActiveAutomations', 'maxTickets', 'maxForms',
  'maxCustomFieldsPerEntity', 'maxFileUploadBytes',
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { planId: true, settings: true },
    });

    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const planRow = await db.query.planLimits.findFirst({
      where: eq(planLimits.planId, tenant.planId),
    });

    const overrides = ((tenant.settings as Record<string, unknown>)?.limitOverrides as Record<string, number | null>) ?? {};

    const limits: Record<string, { planDefault: number | null; override: number | null; effective: number | null }> = {};
    for (const field of LIMIT_FIELDS) {
      const planVal = planRow ? (planRow[field as keyof typeof planRow] as number | null) : null;
      const override = field in overrides ? overrides[field] : null;
      limits[field] = {
        planDefault: planVal ?? null,
        override: override ?? null,
        effective: override ?? planVal ?? null,
      };
    }

    return NextResponse.json({ data: limits, planId: tenant.planId });
  } catch (error) {
    console.error('[superadmin/tenants/[id]/limits/GET]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { settings: true },
    });

    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const guardResult = await concurrencyGuard(db, tenants, id, id, body.expectedUpdatedAt);
    if (guardResult) return guardResult;

    const currentSettings = (tenant.settings as Record<string, unknown>) ?? {};
    const currentOverrides = (currentSettings.limitOverrides as Record<string, number | null>) ?? {};

    const newOverrides: Record<string, number | null> = { ...currentOverrides };

    for (const field of LIMIT_FIELDS) {
      if (field in body) {
        const val = body[field];
        if (val === null || val === 'null' || val === '' || val === undefined) {
          delete newOverrides[field];
        } else {
          const num = Number(val);
          if (Number.isNaN(num) || num < 0) {
            return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
          }
          newOverrides[field] = num;
        }
      }
    }

    const newSettings = { ...currentSettings, limitOverrides: newOverrides };

    const [updated] = await db
      .update(tenants)
      .set({ settings: newSettings })
      .where(eq(tenants.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'tenant.settings_changed',
      targetType: 'tenant',
      targetId: id,
      metadata: { limitOverrides: Object.keys(newOverrides) },
    });

    return NextResponse.json({ ok: true, limitOverrides: newOverrides });
  } catch (error) {
    console.error('[superadmin/tenants/[id]/limits/PATCH]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const CUSTOM_REPORTS_KEY = 'custom_reports';

interface ReportConfig {
  id: string;
  name: string;
  description: string;
  type: 'contacts' | 'companies' | 'deals' | 'tasks' | 'leads' | 'pipeline' | 'revenue';
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: Record<string, any>;
  columns: string[];
  groupBy?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const [setting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, CUSTOM_REPORTS_KEY)
      ))
      .limit(1);

    const reports: ReportConfig[] = setting?.value ? JSON.parse(String(setting.value)) : [];

    return NextResponse.json({ data: reports });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/reports/custom GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const report = await readJsonBody(request);

    if (!report.name || !report.type) {
      return NextResponse.json({ error: 'Name and type required' }, { status: 400 });
    }

    const newReport: ReportConfig = {
      id: uuidv4(),
      name: report.name,
      description: report.description || '',
      type: report.type,
      filters: report.filters || {},
      columns: report.columns || [],
      groupBy: report.groupBy,
      sortBy: report.sortBy,
      sortOrder: report.sortOrder || 'desc',
    };

    const [setting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, CUSTOM_REPORTS_KEY)
      ))
      .limit(1);

    const reports: ReportConfig[] = setting?.value ? JSON.parse(String(setting.value)) : [];
    reports.push(newReport);

    await db
      .insert(platformSettings)
      .values({
        tenantId: ctx.tenantId,
        key: CUSTOM_REPORTS_KEY,
        value: JSON.stringify(reports),
      })
      .onConflictDoUpdate({
        target: [platformSettings.tenantId, platformSettings.key],
        set: { value: JSON.stringify(reports), updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true, data: newReport });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/reports/custom POST' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await readJsonBody(request);

    const [setting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, CUSTOM_REPORTS_KEY)
      ))
      .limit(1);

    const reports: ReportConfig[] = setting?.value ? JSON.parse(String(setting.value)) : [];
    const filtered = reports.filter(r => r.id !== id);

    await db
      .update(platformSettings)
      .set({ value: JSON.stringify(filtered) })
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, CUSTOM_REPORTS_KEY)
      ));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/reports/custom DELETE' });
    return apiError(err);
  }
});
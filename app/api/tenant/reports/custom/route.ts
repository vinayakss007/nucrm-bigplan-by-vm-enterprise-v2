import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const CUSTOM_REPORTS_KEY = 'custom_reports';

interface ReportConfig {
  id: string;
  name: string;
  description: string;
  type: 'contacts' | 'companies' | 'deals' | 'tasks' | 'leads' | 'pipeline' | 'revenue';
  filters: Record<string, any>;
  columns: string[];
  groupBy?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function GET(request: NextRequest) {
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
  } catch (err: any) {
    console.error('[custom reports GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const report = await request.json();

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
        set: { value: JSON.stringify(reports) },
      });

    return NextResponse.json({ ok: true, data: newReport });
  } catch (err: any) {
    console.error('[custom reports POST]', err);
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await request.json();

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
  } catch (err: any) {
    console.error('[custom reports DELETE]', err);
    return apiError(err);
  }
}
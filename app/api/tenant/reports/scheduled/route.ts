/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { scheduledReports } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { z } from 'zod';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const;

// Allowlist of client-updatable fields (#scheduled-reports mass-assignment).
// tenantId, createdBy, id, timestamps, lastRunAt and nextRunAt are server-owned
// and must never be assignable from the request body.
const updateScheduledReportSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(50).optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  recipients: z.array(z.string().email()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  format: z.enum(['pdf', 'csv', 'xlsx']).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
});

function nextRunFrom(frequency: (typeof FREQUENCIES)[number], from: Date = new Date()): Date {
  const nextRun = new Date(from);
  switch (frequency) {
    case 'hourly': nextRun.setHours(nextRun.getHours() + 1); break;
    case 'daily': nextRun.setDate(nextRun.getDate() + 1); break;
    case 'weekly': nextRun.setDate(nextRun.getDate() + 7); break;
    case 'monthly': nextRun.setMonth(nextRun.getMonth() + 1); break;
  }
  return nextRun;
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const reports = await db.select()
      .from(scheduledReports)
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        isNull(scheduledReports.deletedAt)
      ))
      .orderBy(desc(scheduledReports.createdAt));

    return NextResponse.json({ data: reports });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'reports/scheduled GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const body = await readJsonBody(request);
    if (!body.name || !body.type || !body.frequency) {
      return NextResponse.json({ error: 'Name, type, and frequency required' }, { status: 400 });
    }

    const nextRun = nextRunFrom(body.frequency);

    const [report] = await db.insert(scheduledReports).values({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      name: body.name,
      type: body.type,
      frequency: body.frequency,
      recipients: body.recipients || [],
      config: body.config || {},
      format: body.format || 'csv',
      nextRunAt: nextRun,
    }).returning();

    return NextResponse.json({ data: report }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'reports/scheduled POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const { id, expectedUpdatedAt: expectedUpdatedAtRaw, ...rest } = await readJsonBody(request);
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    // Validate + allowlist the update payload — never spread the raw body into
    // .set(), which would allow overwriting tenantId/createdBy/etc.
    const parsed = validateBody(updateScheduledReportSchema, rest);
    if (parsed instanceof NextResponse) return parsed;
    const updates = parsed.data;

    const expectedUpdatedAt = expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : null;
    const guard = await concurrencyGuard(db, scheduledReports, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    // When the cadence changes, recompute the next run so it takes effect.
    const nextRunAt = updates.frequency ? nextRunFrom(updates.frequency) : undefined;

    await db.update(scheduledReports)
      .set({ ...updates, ...(nextRunAt ? { nextRunAt } : {}), updatedAt: new Date() })
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        eq(scheduledReports.id, id)
      ));

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const { id } = await readJsonBody(request);
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    await db.update(scheduledReports)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        eq(scheduledReports.id, id)
      ));

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { dunningSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const dunningConfigSchema = z.object({
  maxRetries: z.number().min(1).max(10).optional().default(3),
  retryIntervalDays: z.number().min(1).max(30).optional().default(1),
  gracePeriodDays: z.number().min(1).max(90).optional().default(7),
  suspensionAction: z.enum(['downgrade', 'suspend', 'cancel']).optional().default('downgrade'),
  retrySchedule: z.array(z.number()).optional().default([1, 3, 7, 14]),
  emailNotifications: z.boolean().optional().default(true),
  webhookNotifications: z.boolean().optional().default(false),
});

/**
 * GET /api/tenant/billing/dunning
 * Get dunning configuration for the tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const settings = await db.query.dunningSettings.findFirst({
      where: eq(dunningSettings.tenantId, ctx.tenantId),
    });

    if (!settings) {
      // Return default settings
      return NextResponse.json({
        data: {
          maxRetries: 3,
          retryIntervalDays: 1,
          gracePeriodDays: 7,
          suspensionAction: 'downgrade',
          retrySchedule: [1, 3, 7, 14],
          emailNotifications: true,
          webhookNotifications: false,
          isActive: true,
        },
      });
    }

    return NextResponse.json({ data: settings });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/billing/dunning
 * Create or update dunning configuration for the tenant.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const raw = await readJsonBody(request);
    const parsed = validateBody(dunningConfigSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const config = parsed.data;

    // Check if settings already exist
    const existingSettings = await db.query.dunningSettings.findFirst({
      where: eq(dunningSettings.tenantId, ctx.tenantId),
    });

    if (existingSettings) {
      // Update existing settings
      await db.update(dunningSettings).set({
        maxRetries: config.maxRetries,
        retryIntervalDays: config.retryIntervalDays,
        gracePeriodDays: config.gracePeriodDays,
        suspensionAction: config.suspensionAction,
        retrySchedule: config.retrySchedule,
        emailNotifications: config.emailNotifications,
        webhookNotifications: config.webhookNotifications,
        metadata: {
          ...(existingSettings.metadata as Record<string, unknown> || {}),
          updated_at: new Date().toISOString(),
          updated_by: ctx.userId,
        },
      }).where(eq(dunningSettings.id, existingSettings.id));

      return NextResponse.json({
        data: {
          ...existingSettings,
          ...config,
          message: 'Dunning configuration updated',
        },
      });
    } else {
      // Create new settings
      const [newSettings] = await db.insert(dunningSettings).values({
        tenantId: ctx.tenantId,
        maxRetries: config.maxRetries,
        retryIntervalDays: config.retryIntervalDays,
        gracePeriodDays: config.gracePeriodDays,
        suspensionAction: config.suspensionAction,
        retrySchedule: config.retrySchedule,
        emailNotifications: config.emailNotifications,
        webhookNotifications: config.webhookNotifications,
        metadata: {
          created_at: new Date().toISOString(),
          created_by: ctx.userId,
        },
      }).returning();

      return NextResponse.json({
        data: {
          ...newSettings,
          message: 'Dunning configuration created',
        },
      });
    }
  } catch (err: unknown) {
    return apiError(err);
  }
}

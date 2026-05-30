import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { sendEmail } from '@/lib/email/service';
import { logSuperAdminAction } from '@/lib/audit/super-admin';

const MAX_RECIPIENTS = 500;

const emailBlastSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  html_body: z.string().min(1, 'HTML body is required'),
  text_body: z.string().optional(),
  target: z.enum(['all', 'tenant', 'plan']),
  target_value: z.string().optional(),
  filter_verified_only: z.boolean().optional(),
});

interface TargetUser {
  email: string;
  full_name: string | null;
}

/**
 * Super Admin Email Blast API
 *
 * POST: Send emails to a filtered group of users.
 * Supports targeting all users, users in a specific tenant, or users on a plan.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(emailBlastSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { subject, html_body, text_body, target, target_value, filter_verified_only } = validated.data;

    // Validate target_value when needed
    if ((target === 'tenant' || target === 'plan') && !target_value) {
      return NextResponse.json(
        { error: 'target_value is required for tenant or plan targeting' },
        { status: 400 }
      );
    }

    // Build the user query based on target type
    let targetUsers: TargetUser[] = [];

    if (target === 'all') {
      const query = db
        .selectDistinct({
          email: users.email,
          full_name: users.fullName,
        })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            filter_verified_only
              ? eq(users.emailVerified, true)
              : undefined
          )
        );

      targetUsers = await query;
    } else if (target === 'tenant') {
      targetUsers = await db
        .selectDistinct({
          email: users.email,
          full_name: users.fullName,
        })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(
          and(
            isNull(users.deletedAt),
            eq(tenantMembers.tenantId, target_value!),
            eq(tenantMembers.status, 'active'),
            filter_verified_only ? eq(users.emailVerified, true) : undefined
          )
        );
    } else if (target === 'plan') {
      targetUsers = await db
        .selectDistinct({
          email: users.email,
          full_name: users.fullName,
        })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .where(
          and(
            isNull(users.deletedAt),
            eq(tenants.planId, target_value!),
            eq(tenantMembers.status, 'active'),
            filter_verified_only ? eq(users.emailVerified, true) : undefined
          )
        );
    }

    if (targetUsers.length === 0) {
      return NextResponse.json({
        sent: 0,
        failed: 0,
        total: 0,
      });
    }

    // Enforce recipient cap
    if (targetUsers.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        {
          error: `Recipient count (${targetUsers.length}) exceeds the maximum of ${MAX_RECIPIENTS} per request. Please use a more specific filter to narrow the audience.`,
        },
        { status: 400 }
      );
    }

    // Send emails in batches of 10
    let sent = 0;
    let failed = 0;
    const batchSize = 10;

    for (let i = 0; i < targetUsers.length; i += batchSize) {
      const batch = targetUsers.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((user) =>
          sendEmail({
            to: user.email,
            subject,
            html: html_body,
            text: text_body,
          })
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          sent++;
        } else {
          failed++;
        }
      }
    }

    // Write audit trail
    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email ?? 'unknown',
      action: 'data.exported',
      targetType: 'email_blast',
      metadata: {
        subject,
        target,
        target_value: target_value ?? null,
        filter_verified_only: filter_verified_only ?? false,
        recipient_count: targetUsers.length,
        sent,
        failed,
      },
    });

    return NextResponse.json({
      sent,
      failed,
      total: targetUsers.length,
    });
  } catch (err: unknown) {
    console.error('[superadmin/email-blast POST]', err);
    return apiError(err);
  }
}

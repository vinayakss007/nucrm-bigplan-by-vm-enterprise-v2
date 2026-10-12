/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailLog } from '@/drizzle/schema';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { sendEmail } from '@/lib/email/service';
import { escapeHtml } from '@/lib/email/escape-html';
import { z } from 'zod';

const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  body: z.string().max(20000).default(''),
});

/**
 * The compose form on /tenant/emails. `/api/tenant/email/test` only proves a
 * provider is configured — it ignores the drafted subject and body. This is the
 * send that the page promises, and the sole writer of `email_log`, which is
 * what /api/tenant/email/tracking lists.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await checkRateLimit(req, { action: 'email_manual_send', max: 10, windowMinutes: 60 });
  if (limited) return limited;

  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'contacts.edit');
    if (permErr) return permErr;

    const parsed = validateBody(sendSchema, await readJsonBody(req));
    if (parsed instanceof NextResponse) return parsed;
    const { to, subject, body } = parsed.data;

    const result = await sendEmail({
      to,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(body)}</div>`,
    });

    const [logged] = await db.insert(emailLog).values({
      tenantId: ctx.tenantId,
      fromEmail: process.env.SMTP_FROM_EMAIL ?? 'noreply@nucrm.io',
      toEmail: to,
      subject,
      body,
      status: result.success ? 'sent' : 'failed',
      provider: result.provider ?? null,
      providerMessageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
      sentAt: result.success ? new Date() : null,
    }).returning({ id: emailLog.id });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: result.success ? 'email_sent' : 'email_send_failed',
      entityType: 'email',
      entityId: logged?.id,
      newData: { to, subject, provider: result.provider ?? null, error: result.error ?? null },
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Send failed' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, id: logged?.id, provider: result.provider ?? null });
  } catch (err: unknown) { return apiError(err); }
});

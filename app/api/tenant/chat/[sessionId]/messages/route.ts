/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { sendMessage, getSessionMessages } from '@/lib/chat';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const sendMessageSchema = z.object({
  content: z.string().min(1),
  senderType: z.enum(['visitor', 'agent', 'bot']),
  senderId: z.string().optional(),
});

export const GET = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const { sessionId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));

    const messages = await getSessionMessages(sessionId, ctx.tenantId, limit);

    return NextResponse.json({ data: messages });
  } catch (err) {
    return apiError(err);
  }
});

export const POST = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const { sessionId } = await params;
    const body = await readJsonBody(req);
    const validated = validateBody(sendMessageSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const result = await sendMessage({
      sessionId,
      tenantId: ctx.tenantId,
      content: v.content,
      senderType: v.senderType,
      senderId: v.senderId,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.message }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
});

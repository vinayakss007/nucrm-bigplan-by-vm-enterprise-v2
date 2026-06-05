import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { sendMessage, getSessionMessages } from '@/lib/chat';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const sendMessageSchema = z.object({
  content: z.string().min(1),
  senderType: z.enum(['visitor', 'agent', 'bot']),
  senderId: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const { sessionId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));

    const messages = await getSessionMessages(sessionId, ctx.tenantId, limit);

    return NextResponse.json({ data: messages });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const { sessionId } = await params;
    const body = await req.json();
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
}

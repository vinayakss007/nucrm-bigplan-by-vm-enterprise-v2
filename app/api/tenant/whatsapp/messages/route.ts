/**
 * GET /api/tenant/whatsapp/messages?contact_id=xxx
 * List WhatsApp messages for a specific contact
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { whatsappMessages, whatsappConversations } from '@/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const contactId = searchParams.get('contact_id');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    // Join with conversations to filter by contact_id
    const messages = await db.select({
      id: whatsappMessages.id,
      tenantId: whatsappMessages.tenantId,
      conversationId: whatsappMessages.conversationId,
      direction: whatsappMessages.direction,
      contentType: whatsappMessages.contentType,
      content: whatsappMessages.content,
      status: whatsappMessages.status,
      delivered: whatsappMessages.delivered,
      readAt: whatsappMessages.readAt,
      createdAt: whatsappMessages.createdAt,
      metadata: whatsappMessages.metadata,
      contactId: whatsappConversations.contactId,
    })
    .from(whatsappMessages)
    .innerJoin(whatsappConversations, eq(whatsappMessages.conversationId, whatsappConversations.id))
    .where(and(
      eq(whatsappConversations.contactId, contactId),
      eq(whatsappMessages.tenantId, ctx.tenantId)
    ))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(limit);

    return NextResponse.json({ data: messages });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/whatsapp/send
 * Send WhatsApp messages (template or free-form) via Meta Cloud API
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { sendWhatsAppSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations, whatsappConversations, whatsappMessages } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await req.json();
    const validated = validateBody(sendWhatsAppSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { to, message_type, content, template_name, language, contact_id } = v;

    if (!to) {
      return NextResponse.json({ error: 'to (phone number) is required' }, { status: 400 });
    }

    // Find tenant's WhatsApp integration
    const [integration] = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.tenantId, ctx.tenantId),
        eq(integrations.type, 'whatsapp'),
        eq(integrations.isActive, true)
      ))
      .orderBy(desc(integrations.createdAt))
      .limit(1);

    if (!integration) {
      return NextResponse.json({ error: 'WhatsApp integration not configured' }, { status: 400 });
    }

    const config = integration.config as any;
    const phoneNumberId = config?.phone_number_id;
    const accessToken = config?.access_token;

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp credentials not configured' }, { status: 400 });
    }

    let requestBody: any;

    if (message_type === 'template') {
      // Send template message
      if (!template_name) {
        return NextResponse.json({ error: 'template_name is required for template messages' }, { status: 400 });
      }

      requestBody = {
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9]/g, ''),
        type: 'template',
        template: {
          name: template_name,
          language: { code: language || 'en' },
          components: content?.components || [],
        },
      };
    } else {
      // Send free-form text
      requestBody = {
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9]/g, ''),
        type: 'text',
        text: {
          // HIGH-01: Fix JS operator precedence: ?? binds tighter than ? :
          body: content?.body ?? (message_type === 'text' ? content : 'Hello from NuCRM!'),
        },
      };
    }

    // Send via Meta API
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15_000),
      }
    );

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: responseData.error?.message || 'Failed to send WhatsApp message' },
        { status: 400 }
      );
    }

    const messageId = responseData.messages?.[0]?.id;

    // Store outbound message in transaction
    await db.transaction(async (tx) => {
      // 1. Find or create conversation
      let convId: string;
      
      if (contact_id) {
        const [existingConv] = await tx.select({ id: whatsappConversations.id })
          .from(whatsappConversations)
          .where(and(
            eq(whatsappConversations.tenantId, ctx.tenantId),
            eq(whatsappConversations.contactId, contact_id)
          ))
          .limit(1);
          
        if (existingConv) {
          convId = existingConv.id;
        } else {
          const [newConv] = await tx.insert(whatsappConversations).values({
            tenantId: ctx.tenantId,
            contactId: contact_id,
            whatsappFrom: phoneNumberId,
            whatsappTo: to,
          }).returning({ id: whatsappConversations.id });
          if (!newConv) throw new Error('Failed to create conversation');
          convId = newConv.id;
        }
      } else {
        // Fallback if no contact_id
        const [existingConv] = await tx.select({ id: whatsappConversations.id })
          .from(whatsappConversations)
          .where(and(
            eq(whatsappConversations.tenantId, ctx.tenantId),
            eq(whatsappConversations.whatsappTo, to)
          ))
          .limit(1);
          
        if (existingConv) {
          convId = existingConv.id;
        } else {
          const [newConv] = await tx.insert(whatsappConversations).values({
            tenantId: ctx.tenantId,
            whatsappFrom: phoneNumberId,
            whatsappTo: to,
          }).returning({ id: whatsappConversations.id });
          if (!newConv) throw new Error('Failed to create conversation');
          convId = newConv.id;
        }
      }

      // 2. Insert message
      await tx.insert(whatsappMessages).values({
        conversationId: convId,
        tenantId: ctx.tenantId,
        direction: 'outbound',
        contentType: message_type === 'template' ? 'template' : 'text',
        content: message_type === 'template' ? `Template: ${template_name}` : (requestBody.text?.body || ''),
        externalId: messageId,
        status: 'sent',
        metadata: responseData,
      });

      // 3. Update conversation last message time
      await tx.update(whatsappConversations)
        .set({ 
          lastMessageAt: new Date(),
          messageCount: sql`message_count + 1`
        })
        .where(eq(whatsappConversations.id, convId));
    });

    return NextResponse.json({
      ok: true,
      message_id: messageId,
      data: responseData,
    }, { status: 201 });
  } catch (err: any) {
    console.error('[WhatsApp Send] Error:', err.message);
    return apiError(err);
  }
}

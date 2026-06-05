import { apiError } from '@/lib/api-error';
/**
 * WhatsApp Business API Webhook
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { 
  integrations, 
  contacts, 
  whatsappConversations, 
  whatsappMessages, 
  activities 
} from '@/drizzle/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'crypto';

// ─── GET: Verify Webhook ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// ─── POST: Receive Messages & Status Updates ─────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-hub-signature-256');
    const appSecret = process.env['WHATSAPP_APP_SECRET'];

    if (!signature || !appSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await req.text();
    const expectedSignature = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Async processing to meet Meta's 15s requirement
    processWhatsAppPayload(body).catch(err => {
      console.error('[WhatsApp Webhook] Async processing error:', err);
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[WhatsApp Webhook] Error:', err.message);
    return apiError(err);
  }
}

async function processWhatsAppPayload(body: any) {
  const entry = body.entry?.[0];
  if (!entry) return;

  const changes = entry.changes?.[0];
  if (!changes) return;

  const value = changes.value;
  const receivingPhoneId = value?.metadata?.phone_number_id;

  if (!receivingPhoneId) return;

  // ── Inbound Message ──────────────────────────────────────────────────────
  if (value.messages) {
    for (const msg of value.messages) {
      const from = msg.from; 
      const msgType = msg.type; 
      const text = msg.text?.body || '';

      // 1. Find integration
      const integrationRow = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.type, 'whatsapp'),
          eq(integrations.isActive, true),
          sql`${integrations.config}->>'phone_number_id' = ${receivingPhoneId}`
        )
      });

      if (!integrationRow) continue;

      // 2. Find contact
      const contactRow = await db.query.contacts.findFirst({
        where: and(
          eq(contacts.tenantId, integrationRow.tenantId),
          or(
            eq(contacts.phone, from),
            eq(contacts.phone, `+${from}`),
            eq(contacts.phone, from.replace(/^\+/, ''))
          )
        )
      });

      // 3. Process message in transaction
      await db.transaction(async (tx) => {
        // Find or create conversation
        let conversation = await tx.query.whatsappConversations.findFirst({
          where: and(
            eq(whatsappConversations.tenantId, integrationRow.tenantId),
            eq(whatsappConversations.whatsappFrom, from),
            eq(whatsappConversations.whatsappTo, receivingPhoneId)
          )
        });

        if (!conversation) {
          [conversation] = await tx.insert(whatsappConversations).values({
            tenantId: integrationRow.tenantId,
            contactId: contactRow?.id || null,
            whatsappFrom: from,
            whatsappTo: receivingPhoneId,
            messageCount: 1,
            lastMessageAt: new Date()
          }).returning();
        } else {
          await tx.update(whatsappConversations)
            .set({ 
              messageCount: sql`${whatsappConversations.messageCount} + 1`,
              lastMessageAt: new Date(),
              contactId: contactRow?.id || conversation.contactId // Update contact if it was null
            })
            .where(eq(whatsappConversations.id, conversation!.id));
        }

        // Store message
        await tx.insert(whatsappMessages).values({
          conversationId: conversation!.id,
          tenantId: integrationRow.tenantId,
          direction: 'inbound',
          contentType: msgType,
          content: text,
          externalId: msg.id,
          status: 'received',
          metadata: msg
        });

        // Activity log
        if (contactRow) {
          await tx.insert(activities).values({
            tenantId: integrationRow.tenantId,
            contactId: contactRow.id,
            eventType: 'whatsapp_inbound',
            description: `WhatsApp message from ${from}`,
            metadata: { message_type: msgType, body: text },
            entityType: 'contact',
            entityId: contactRow.id,
            action: 'whatsapp_message'
          });
        }
      });
    }
  }

  // ── Status Update ────────────────────────────────────────────────────────
  if (value.statuses) {
    for (const status of value.statuses) {
      const msgStatus = status.status; 
      const msgId = status.id;

      await db.update(whatsappMessages)
        .set({ 
          status: msgStatus,
          delivered: msgStatus === 'delivered' || msgStatus === 'read',
          readAt: msgStatus === 'read' ? new Date() : undefined,
          updatedAt: new Date(),
          metadata: sql`jsonb_set(${whatsappMessages.metadata}, '{last_status_update}', ${JSON.stringify(status)}::jsonb)`
        })
        .where(eq(whatsappMessages.externalId, msgId));
    }
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * WhatsApp webhook payload processing (#1256).
 *
 * Extracted from the route handler so both the API route (inline fallback)
 * and the BullMQ worker (retried consumption) share one implementation.
 */
import { db } from '@/drizzle/db';
import {
  integrations,
  contacts,
  whatsappConversations,
  whatsappMessages,
  activities
} from '@/drizzle/schema';
import { eq, and, or, sql } from 'drizzle-orm';

interface WhatsAppInboundMessage {
  id: string;
  from: string;
  type?: string;
  text?: { body?: string };
}

interface WhatsAppStatus {
  id: string;
  status: string;
}

interface WhatsAppChangeValue {
  metadata?: { phone_number_id?: string };
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppWebhookBody {
  entry?: Array<{ changes?: Array<{ value?: WhatsAppChangeValue }> }>;
}

export async function processWhatsAppPayload(body: WhatsAppWebhookBody) {
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
        // H-A: idempotency. The webhook is retried (BullMQ attempts:5) and Meta
        // redelivers on a 500, so the same msg.id can arrive multiple times. If
        // we've already stored this (tenant, external_id) message, skip the
        // whole side-effect block — otherwise we'd duplicate the message row,
        // double-increment messageCount, and log a duplicate activity.
        if (msg.id) {
          const existing = await tx.query.whatsappMessages.findFirst({
            columns: { id: true },
            where: and(
              eq(whatsappMessages.tenantId, integrationRow.tenantId),
              eq(whatsappMessages.externalId, msg.id),
            ),
          });
          if (existing) return; // already processed this inbound message
        }

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
    // H-B: resolve the tenant that owns this WhatsApp number so status updates
    // are scoped to it. Meta's message id (status.id) is NOT unique across
    // tenants and the column has no unique constraint, so filtering on
    // external_id alone would let a status callback (or a crafted/colliding id)
    // flip ANOTHER tenant's message row. If we can't resolve the integration we
    // skip rather than write globally.
    const statusIntegration = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.type, 'whatsapp'),
        eq(integrations.isActive, true),
        sql`${integrations.config}->>'phone_number_id' = ${receivingPhoneId}`
      )
    });
    if (!statusIntegration) return;

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
        .where(and(
          eq(whatsappMessages.externalId, msgId),
          eq(whatsappMessages.tenantId, statusIntegration.tenantId),
        ));
    }
  }
}

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
 *
 * #3246 step 4d split the database work in two, because a webhook carries no workspace
 * until the integration it names has been read. `resolveWhatsAppTenant` runs in one
 * transaction carrying migration 0142's SELECT-only claim on that row and projects
 * {id, tenantId} and nothing else; everything after it runs under the tenant that lookup
 * returned. Before this, both halves ran on the bare pool: `integrations`' only arm is
 * `tenant_isolation`, which the pooled reset lists leave unable to match, so the lookup
 * found no row, every inbound message was `continue`d over and every delivery status
 * `return`ed on, while the route answered `{success:true}` and Meta stopped redelivering.
 */
import {
  integrations,
  contacts,
  whatsappConversations,
  whatsappMessages,
  activities
} from '@/drizzle/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import { NO_USER_SENTINEL, withTenantContext } from '@/lib/db/rls';
import { withWhatsAppIntegrationLookupContext } from '@/lib/db/whatsapp-integration-context';

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

/**
 * The one pre-auth read: whose integration is this phone number? A payload naming an
 * unknown, disabled or non-whatsapp integration resolves to nothing and the caller writes
 * nothing — the fail-closed half, and the same answer #1256's H-B comment demands.
 */
async function resolveWhatsAppTenant(phoneNumberId: string): Promise<string | null> {
  const [row] = await withWhatsAppIntegrationLookupContext(phoneNumberId, (tx) =>
    tx
      .select({ id: integrations.id, tenantId: integrations.tenantId })
      .from(integrations)
      .where(
        and(
          eq(integrations.type, 'whatsapp'),
          eq(integrations.isActive, true),
          sql`${integrations.config}->>'phone_number_id' = ${phoneNumberId}`
        )
      )
      .limit(1)
  );
  return row?.tenantId ?? null;
}

export async function processWhatsAppPayload(body: WhatsAppWebhookBody) {
  const entry = body.entry?.[0];
  if (!entry) return;

  const changes = entry.changes?.[0];
  if (!changes) return;

  const value = changes.value;
  const receivingPhoneId = value?.metadata?.phone_number_id;

  if (!receivingPhoneId) return;

  const inbound = value.messages ?? [];
  const statuses = value.statuses ?? [];
  if (inbound.length === 0 && statuses.length === 0) return;

  const tenantId = await resolveWhatsAppTenant(receivingPhoneId);
  if (!tenantId) return;

  // ── Inbound Message ──────────────────────────────────────────────────────
  for (const msg of inbound) {
    const from = msg.from;
    const msgType = msg.type;
    const text = msg.text?.body || '';

    await withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
      const [contactRow] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            or(
              eq(contacts.phone, from),
              eq(contacts.phone, `+${from}`),
              eq(contacts.phone, from.replace(/^\+/, ''))
            )
          )
        )
        .limit(1);

      // H-A: idempotency. The webhook is retried (BullMQ attempts:5) and Meta
      // redelivers on a 500, so the same msg.id can arrive multiple times. If
      // we've already stored this (tenant, external_id) message, skip the whole
      // side-effect block — otherwise we'd duplicate the message row,
      // double-increment messageCount, and log a duplicate activity.
      if (msg.id) {
        const [existing] = await tx
          .select({ id: whatsappMessages.id })
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.tenantId, tenantId),
              eq(whatsappMessages.externalId, msg.id)
            )
          )
          .limit(1);
        if (existing) return; // already processed this inbound message
      }

      // Find or create conversation
      const [found] = await tx
        .select({ id: whatsappConversations.id, contactId: whatsappConversations.contactId })
        .from(whatsappConversations)
        .where(
          and(
            eq(whatsappConversations.tenantId, tenantId),
            eq(whatsappConversations.whatsappFrom, from),
            eq(whatsappConversations.whatsappTo, receivingPhoneId)
          )
        )
        .limit(1);
      let conversation = found;

      if (!conversation) {
        const [created] = await tx
          .insert(whatsappConversations)
          .values({
            tenantId,
            contactId: contactRow?.id ?? null,
            whatsappFrom: from,
            whatsappTo: receivingPhoneId,
            messageCount: 1,
            lastMessageAt: new Date()
          })
          .returning({ id: whatsappConversations.id, contactId: whatsappConversations.contactId });
        // A 0-row insert here is RLS refusing the write, not a race: reporting it
        // keeps the job from storing a message against `undefined` and moving on.
        if (!created) throw new Error(`whatsapp conversation insert matched no row for ${from}`);
        conversation = created;
      } else {
        await tx
          .update(whatsappConversations)
          .set({
            messageCount: sql`${whatsappConversations.messageCount} + 1`,
            lastMessageAt: new Date(),
            // Update contact if it was null
            contactId: contactRow?.id ?? conversation.contactId
          })
          .where(eq(whatsappConversations.id, conversation.id));
      }

      // Store message
      await tx.insert(whatsappMessages).values({
        conversationId: conversation.id,
        tenantId,
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
          tenantId,
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

  // ── Status Update ────────────────────────────────────────────────────────
  // H-B: Meta's message id (status.id) is NOT unique across tenants and the column has
  // no unique constraint, so a status callback is applied to the rows of the tenant that
  // owns this phone number and to nobody else — filtering on external_id alone would let
  // a crafted or colliding id flip another tenant's message row.
  if (statuses.length === 0) return;

  await withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    for (const status of statuses) {
      const msgStatus = status.status;

      await tx
        .update(whatsappMessages)
        .set({
          status: msgStatus,
          delivered: msgStatus === 'delivered' || msgStatus === 'read',
          readAt: msgStatus === 'read' ? new Date() : undefined,
          updatedAt: new Date(),
          metadata: sql`jsonb_set(${whatsappMessages.metadata}, '{last_status_update}', ${JSON.stringify(status)}::jsonb)`
        })
        .where(
          and(
            eq(whatsappMessages.externalId, status.id),
            eq(whatsappMessages.tenantId, tenantId)
          )
        );
    }
  });
}

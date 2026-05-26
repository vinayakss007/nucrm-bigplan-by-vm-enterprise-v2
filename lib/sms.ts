/**
 * SMS / Twilio Integration Module
 *
 * Provides SMS sending, template-based messaging, incoming message handling,
 * and delivery status tracking via Twilio. Part of the messaging bundle
 * gated to the 'whatsapp-bot' module.
 */
import { db } from '@/drizzle/db';
import { smsMessages, smsTemplates } from '@/drizzle/schema/sms';
import { contacts } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

// ── Types ──────────────────────────────────────────────
export interface SendSMSOptions {
  to: string;
  body: string;
  tenantId: string;
  contactId?: string;
  from?: string;
}

export interface SendTemplateSMSOptions {
  to: string;
  templateId: string;
  variables: Record<string, string>;
  tenantId: string;
  contactId?: string;
}

export interface IncomingSMSPayload {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
  AccountSid?: string;
  NumMedia?: string;
}

export interface DeliveryStatusPayload {
  MessageSid: string;
  MessageStatus: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

// ── Template Interpolation ─────────────────────────────

/**
 * Interpolate template variables in a string.
 * Supports {{contact.name}}, {{deal.value}}, {{company.name}}, and any custom key.
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}

/**
 * Extract variable placeholders from a template string.
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+(?:\.\w+)*)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

// ── Twilio Client ──────────────────────────────────────

function getTwilioConfig() {
  return {
    accountSid: process.env['TWILIO_ACCOUNT_SID'] || '',
    authToken: process.env['TWILIO_AUTH_TOKEN'] || '',
    fromNumber: process.env['TWILIO_FROM_NUMBER'] || '',
  };
}

/**
 * Validate Twilio webhook signature using X-Twilio-Signature header.
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const config = getTwilioConfig();
  if (!config.authToken) return false;

  // Build the data string per Twilio's spec
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const computed = crypto
    .createHmac('sha1', config.authToken)
    .update(data)
    .digest('base64');

  return computed === signature;
}

// ── Core Functions ─────────────────────────────────────

/**
 * Send an SMS message via Twilio.
 */
export async function sendSMS(options: SendSMSOptions) {
  const config = getTwilioConfig();
  const from = options.from || config.fromNumber;

  // Record the message in DB
  const [message] = await db.insert(smsMessages).values({
    tenantId: options.tenantId,
    contactId: options.contactId || null,
    direction: 'outbound',
    to: options.to,
    from,
    body: options.body,
    status: 'queued',
  }).returning();

  try {
    // Call Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: options.to, From: from, Body: options.body }),
    });

    if (!response.ok) {
      const error = await response.json();
      await db.update(smsMessages)
        .set({ status: 'failed', errorCode: String(error.code || 'UNKNOWN') })
        .where(eq(smsMessages.id, message!.id));
      return { success: false, messageId: message!.id, error: error.message };
    }

    const result = await response.json();
    await db.update(smsMessages)
      .set({ status: 'sent', twilioSid: result.sid })
      .where(eq(smsMessages.id, message!.id));

    return { success: true, messageId: message!.id, twilioSid: result.sid };
  } catch (err) {
    await db.update(smsMessages)
      .set({ status: 'failed', errorCode: 'NETWORK_ERROR' })
      .where(eq(smsMessages.id, message!.id));
    return { success: false, messageId: message!.id, error: String(err) };
  }
}

/**
 * Send a template-based SMS with variable interpolation.
 */
export async function sendTemplateSMS(options: SendTemplateSMSOptions) {
  // Fetch template
  const template = await db.query.smsTemplates.findFirst({
    where: and(
      eq(smsTemplates.id, options.templateId),
      eq(smsTemplates.tenantId, options.tenantId)
    ),
  });

  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  const body = interpolateTemplate(template.body, options.variables);

  const [message] = await db.insert(smsMessages).values({
    tenantId: options.tenantId,
    contactId: options.contactId || null,
    direction: 'outbound',
    to: options.to,
    from: getTwilioConfig().fromNumber,
    body,
    templateId: template.id,
    status: 'queued',
  }).returning();

  const config = getTwilioConfig();
  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: options.to, From: config.fromNumber, Body: body }),
    });

    if (!response.ok) {
      const error = await response.json();
      await db.update(smsMessages)
        .set({ status: 'failed', errorCode: String(error.code || 'UNKNOWN') })
        .where(eq(smsMessages.id, message!.id));
      return { success: false, messageId: message!.id, error: error.message };
    }

    const result = await response.json();
    await db.update(smsMessages)
      .set({ status: 'sent', twilioSid: result.sid })
      .where(eq(smsMessages.id, message!.id));

    return { success: true, messageId: message!.id, twilioSid: result.sid, interpolatedBody: body };
  } catch (err) {
    await db.update(smsMessages)
      .set({ status: 'failed', errorCode: 'NETWORK_ERROR' })
      .where(eq(smsMessages.id, message!.id));
    return { success: false, messageId: message!.id, error: String(err) };
  }
}

/**
 * Handle incoming SMS from Twilio webhook.
 * Creates a record and optionally links to existing contact.
 */
export async function handleIncomingSMS(payload: IncomingSMSPayload, tenantId: string) {
  // Try to find contact by phone number
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.phone, payload.From),
    columns: { id: true },
  });

  const [message] = await db.insert(smsMessages).values({
    tenantId,
    contactId: contact?.id || null,
    direction: 'inbound',
    to: payload.To,
    from: payload.From,
    body: payload.Body,
    twilioSid: payload.MessageSid,
    status: 'delivered',
  }).returning();

  return { messageId: message!.id, contactId: contact?.id || null };
}

/**
 * Update delivery status from Twilio status callback.
 */
export async function updateDeliveryStatus(payload: DeliveryStatusPayload) {
  const statusMap: Record<string, string> = {
    queued: 'queued',
    sent: 'sent',
    delivered: 'delivered',
    undelivered: 'failed',
    failed: 'failed',
  };

  const status = statusMap[payload.MessageStatus] || payload.MessageStatus;

  await db.update(smsMessages)
    .set({
      status,
      errorCode: payload.ErrorCode || null,
    })
    .where(eq(smsMessages.twilioSid, payload.MessageSid));

  return { updated: true, status };
}

/**
 * Get delivery status of a specific message.
 */
export async function getDeliveryStatus(messageId: string) {
  const message = await db.query.smsMessages.findFirst({
    where: eq(smsMessages.id, messageId),
    columns: { id: true, status: true, twilioSid: true, errorCode: true, createdAt: true },
  });

  if (!message) return null;
  return message;
}

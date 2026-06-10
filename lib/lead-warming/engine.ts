/**
 * Lead Warming Engine — Premium Module
 *
 * Core logic for auto-sending personalized emails + WhatsApp messages
 * on festivals, birthdays, follow-ups, and custom events.
 *
 * Features:
 * - Built-in festival calendar (India + Global)
 * - AI-generated personalized messages per contact
 * - Multi-channel: Email + WhatsApp + SMS
 * - Cooldown & rate limiting per contact
 * - Birthday/anniversary detection from contact fields
 * - Respects opt-out and do-not-contact flags
 */

import { db } from '@/drizzle/db';
import { contacts } from '@/drizzle/schema';
import {
  leadWarmingEvents,
  leadWarmingCampaigns,
  leadWarmingMessages,
  leadWarmingSchedule,
} from '@/drizzle/schema/lead-warming';
import { eq, and, sql, lte, gte, isNull, or, inArray } from 'drizzle-orm';
import { chat } from '@/lib/ai/gateway';
import { sendEmail } from '@/lib/email/service';
import { addJob } from '@/lib/queue';

// ── Festival Calendar (System Events) ─────────────────────────────────────

export interface FestivalEvent {
  name: string;
  eventType: 'festival' | 'holiday' | 'season' | 'custom';
  eventMonth: number;
  eventDay: number;
  region: string;        // 'IN' | 'US' | 'global'
  aiPromptHint: string;
  defaultEmailSubject: string;
  defaultWhatsappTemplate?: string;
}

export const SYSTEM_FESTIVALS: FestivalEvent[] = [
  // ── Indian Festivals ──
  { name: 'Diwali', eventType: 'festival', eventMonth: 10, eventDay: 24, region: 'IN',
    aiPromptHint: 'Generate a warm Diwali greeting for a business contact. Mention prosperity, light, and new beginnings.',
    defaultEmailSubject: 'Wishing you a Happy Diwali! ✨' },
  { name: 'Holi', eventType: 'festival', eventMonth: 3, eventDay: 14, region: 'IN',
    aiPromptHint: 'Generate a colorful Holi greeting for a business contact. Keep it warm and professional.',
    defaultEmailSubject: 'Happy Holi! May your life be filled with colors 🎨' },
  { name: 'Makar Sankranti', eventType: 'festival', eventMonth: 1, eventDay: 14, region: 'IN',
    aiPromptHint: 'Generate a warm Makar Sankranti/Pongal greeting. Mention new harvests, warmth, kite flying.',
    defaultEmailSubject: 'Happy Makar Sankranti! 🪁' },
  { name: 'Raksha Bandhan', eventType: 'festival', eventMonth: 8, eventDay: 19, region: 'IN',
    aiPromptHint: 'Generate a warm Raksha Bandhan greeting for a business relationship. Focus on bonds and protection.',
    defaultEmailSubject: 'Happy Raksha Bandhan! Celebrating bonds 🎗️' },
  { name: 'Ganesh Chaturthi', eventType: 'festival', eventMonth: 9, eventDay: 7, region: 'IN',
    aiPromptHint: 'Generate a Ganesh Chaturthi greeting. Mention new beginnings, wisdom, removing obstacles.',
    defaultEmailSubject: 'Ganesh Chaturthi Greetings! 🙏' },
  { name: 'Navratri', eventType: 'festival', eventMonth: 10, eventDay: 3, region: 'IN',
    aiPromptHint: 'Generate a warm Navratri greeting. Mention divine energy, celebration, victory of good.',
    defaultEmailSubject: 'Happy Navratri! 🙏' },
  { name: 'Eid al-Fitr', eventType: 'festival', eventMonth: 3, eventDay: 30, region: 'IN',
    aiPromptHint: 'Generate a respectful Eid greeting for a business contact. Mention blessings, joy, togetherness.',
    defaultEmailSubject: 'Eid Mubarak! 🌙' },
  { name: 'Onam', eventType: 'festival', eventMonth: 8, eventDay: 29, region: 'IN',
    aiPromptHint: 'Generate a warm Onam greeting. Mention harvest, prosperity, King Mahabali.',
    defaultEmailSubject: 'Happy Onam! 🌺' },

  // ── Global Festivals ──
  { name: 'New Year', eventType: 'holiday', eventMonth: 1, eventDay: 1, region: 'global',
    aiPromptHint: 'Generate a New Year greeting for a business contact. Focus on fresh starts, goals, and partnership.',
    defaultEmailSubject: 'Happy New Year! Here\'s to a great year ahead 🎉' },
  { name: 'Christmas', eventType: 'holiday', eventMonth: 12, eventDay: 25, region: 'global',
    aiPromptHint: 'Generate a warm Christmas greeting for a business contact. Inclusive, festive, warm.',
    defaultEmailSubject: 'Merry Christmas & Season\'s Greetings! 🎄' },
  { name: 'Valentine\'s Day', eventType: 'holiday', eventMonth: 2, eventDay: 14, region: 'global',
    aiPromptHint: 'Generate a professional Valentine\'s Day message showing appreciation for a business relationship.',
    defaultEmailSubject: 'We appreciate you! Happy Valentine\'s Day ❤️' },
  { name: 'Easter', eventType: 'holiday', eventMonth: 4, eventDay: 20, region: 'global',
    aiPromptHint: 'Generate a warm Easter greeting. Mention renewal, spring, fresh opportunities.',
    defaultEmailSubject: 'Happy Easter! Wishing you renewal & joy 🐣' },
  { name: 'Thanksgiving', eventType: 'holiday', eventMonth: 11, eventDay: 28, region: 'US',
    aiPromptHint: 'Generate a Thanksgiving greeting. Express gratitude for the business relationship.',
    defaultEmailSubject: 'Happy Thanksgiving! Grateful for you 🦃' },
  { name: 'Independence Day (India)', eventType: 'holiday', eventMonth: 8, eventDay: 15, region: 'IN',
    aiPromptHint: 'Generate a patriotic Independence Day greeting. Mention freedom, progress, pride.',
    defaultEmailSubject: 'Happy Independence Day! 🇮🇳' },
  { name: 'Republic Day (India)', eventType: 'holiday', eventMonth: 1, eventDay: 26, region: 'IN',
    aiPromptHint: 'Generate a warm Republic Day greeting. Mention democracy, unity, progress.',
    defaultEmailSubject: 'Happy Republic Day! 🇮🇳' },

  // ── Business Seasons ──
  { name: 'Financial Year Start', eventType: 'season', eventMonth: 4, eventDay: 1, region: 'IN',
    aiPromptHint: 'Generate a business message for new financial year. Mention goals, growth, fresh budgets.',
    defaultEmailSubject: 'New Financial Year — Let\'s make it count! 📊' },
  { name: 'Mid-Year Check-in', eventType: 'season', eventMonth: 7, eventDay: 1, region: 'global',
    aiPromptHint: 'Generate a mid-year check-in message. Ask how goals are progressing, offer help.',
    defaultEmailSubject: 'Mid-year check-in: How are things going?' },
  { name: 'Year-End Review', eventType: 'season', eventMonth: 12, eventDay: 15, region: 'global',
    aiPromptHint: 'Generate a year-end reflection message. Mention achievements, gratitude, future plans.',
    defaultEmailSubject: 'Reflecting on a great year together 🌟' },
];

// ── Engine Types ──────────────────────────────────────────────────────────

export interface WarmingResult {
  campaignsProcessed: number;
  messagesSent: number;
  messagesQueued: number;
  errors: string[];
  skippedContacts: number;
}

export interface ContactToWarm {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  leadStatus: string | null;
  tags: any;
  birthday: Date | null;
  assignedTo: string | null;
  doNotContact: boolean | null;
}

// ── Core Engine ───────────────────────────────────────────────────────────

/**
 * Main entry point: Process all active campaigns and send warming messages
 * for today's events. Called by the cron job daily.
 */
export async function processLeadWarming(): Promise<WarmingResult> {
  const result: WarmingResult = {
    campaignsProcessed: 0,
    messagesSent: 0,
    messagesQueued: 0,
    errors: [],
    skippedContacts: 0,
  };

  try {
    // 1. Get today's date info
    const now = new Date();
    const todayMonth = now.getMonth() + 1; // 1-12
    const todayDay = now.getDate();

    // 2. Find events happening today (system + tenant events)
    const todayEvents = await db.select()
      .from(leadWarmingEvents)
      .where(and(
        eq(leadWarmingEvents.isActive, true),
        eq(leadWarmingEvents.eventMonth, todayMonth),
        eq(leadWarmingEvents.eventDay, todayDay),
      ));

    // Also check for events that should send X days before
    const upcomingEvents = await db.select()
      .from(leadWarmingEvents)
      .where(and(
        eq(leadWarmingEvents.isActive, true),
        sql`${leadWarmingEvents.eventMonth} = ${todayMonth}`,
        sql`${leadWarmingEvents.eventDay} - ${leadWarmingEvents.sendDaysBefore} = ${todayDay}`,
      ));

    const allTodayEvents = [...todayEvents, ...upcomingEvents];

    if (allTodayEvents.length === 0) {
      // No events today, check for birthday campaigns
      await processBirthdayCampaigns(result, todayMonth, todayDay);
      return result;
    }

    // 3. Get active campaigns
    const activeCampaigns = await db.select()
      .from(leadWarmingCampaigns)
      .where(eq(leadWarmingCampaigns.status, 'active'));

    // 4. Process each campaign
    for (const campaign of activeCampaigns) {
      try {
        await processCampaign(campaign, allTodayEvents, result);
        result.campaignsProcessed++;
      } catch (err: any) {
        result.errors.push(`Campaign ${campaign.id}: ${err.message}`);
      }
    }

    // 5. Also process birthdays
    await processBirthdayCampaigns(result, todayMonth, todayDay);

  } catch (err: any) {
    result.errors.push(`Global error: ${err.message}`);
  }

  return result;
}

/**
 * Process a single campaign for today's events
 */
async function processCampaign(
  campaign: any,
  todayEvents: any[],
  result: WarmingResult,
): Promise<void> {
  // Filter events that this campaign cares about
  const campaignEventIds = (campaign.eventIds as string[]) || [];
  const relevantEvents = todayEvents.filter(e =>
    campaignEventIds.length === 0 || // Empty = all events
    campaignEventIds.includes(e.id)
  );

  if (relevantEvents.length === 0) return;

  // Get eligible contacts for this campaign
  const eligibleContacts = await getEligibleContacts(campaign);

  for (const contact of eligibleContacts) {
    for (const event of relevantEvents) {
      try {
        await sendWarmingMessage(campaign, contact, event, result);
      } catch (err: any) {
        result.errors.push(`Contact ${contact.id} / Event ${event.name}: ${err.message}`);
      }
    }
  }
}

/**
 * Get contacts eligible for warming (respecting filters, cooldown, opt-out)
 */
async function getEligibleContacts(campaign: any): Promise<ContactToWarm[]> {
  const filter = campaign.targetFilter as any || {};

  // Build WHERE conditions
  const conditions: any[] = [
    eq(contacts.tenantId, campaign.tenantId),
    or(eq(contacts.doNotContact, false), isNull(contacts.doNotContact)),
  ];

  // Apply tag/status filters if defined
  if (filter.leadStatus && Array.isArray(filter.leadStatus) && filter.leadStatus.length > 0) {
    conditions.push(inArray(contacts.leadStatus, filter.leadStatus));
  }

  const allContacts = await db.select({
    id: contacts.id,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
    phone: contacts.phone,
    companyName: contacts.companyId,
    leadStatus: contacts.leadStatus,
    tags: contacts.tags,
    birthday: contacts.birthday,
    assignedTo: contacts.assignedTo,
    doNotContact: contacts.doNotContact,
  })
  .from(contacts)
  .where(and(...conditions))
  .limit(500); // Process max 500 contacts per campaign per run

  // Filter out opted-out contacts via schedule table
  const contactIds = allContacts.map(c => c.id);
  if (contactIds.length === 0) return [];

  const optedOut = await db.select({ contactId: leadWarmingSchedule.contactId })
    .from(leadWarmingSchedule)
    .where(and(
      eq(leadWarmingSchedule.campaignId, campaign.id),
      eq(leadWarmingSchedule.optedOut, true),
      inArray(leadWarmingSchedule.contactId, contactIds)
    ));

  const optedOutIds = new Set(optedOut.map(o => o.contactId));

  // Filter out contacts on cooldown
  const onCooldown = await db.select({ contactId: leadWarmingSchedule.contactId })
    .from(leadWarmingSchedule)
    .where(and(
      eq(leadWarmingSchedule.campaignId, campaign.id),
      inArray(leadWarmingSchedule.contactId, contactIds),
      gte(leadWarmingSchedule.nextEligibleAt, new Date())
    ));

  const cooldownIds = new Set(onCooldown.map(c => c.contactId));

  return allContacts.filter(c =>
    !optedOutIds.has(c.id) &&
    !cooldownIds.has(c.id) &&
    (c.email || c.phone) // Must have at least one contact method
  ) as ContactToWarm[];
}

/**
 * Send a warming message to a single contact for a specific event
 */
async function sendWarmingMessage(
  campaign: any,
  contact: ContactToWarm,
  event: any,
  result: WarmingResult,
): Promise<void> {
  const channels: string[] = [];
  if (campaign.enableEmail && contact.email) channels.push('email');
  if (campaign.enableWhatsapp && contact.phone) channels.push('whatsapp');
  if (campaign.enableSms && contact.phone) channels.push('sms');

  if (channels.length === 0) {
    result.skippedContacts++;
    return;
  }

  // Pick the best channel (email preferred, then WhatsApp)
  const channel = channels[0]!;

  // Generate personalized message
  const message = campaign.aiGenerateMessages
    ? await generateAIMessage(campaign, contact, event)
    : getDefaultMessage(contact, event);

  if (channel === 'email' && contact.email) {
    // Queue email via worker
    await addJob('send-email', {
      to: contact.email,
      subject: message.subject,
      body: message.body,
      html: wrapInEmailTemplate(message.body, contact),
      tenantId: campaign.tenantId,
    });

    // Record the message
    await db.insert(leadWarmingMessages).values({
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      contactId: contact.id,
      eventId: event.id || null,
      channel: 'email',
      subject: message.subject,
      body: message.body,
      aiGenerated: campaign.aiGenerateMessages,
      aiModel: message.model || null,
      status: 'queued',
      eventName: event.name,
      personalizedFor: event.name,
    });

    result.messagesQueued++;
  } else if (channel === 'whatsapp' && contact.phone) {
    // Queue WhatsApp message
    await addJob('send-lead-warming', {
      type: 'whatsapp',
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      contactId: contact.id,
      phone: contact.phone,
      message: message.body,
      templateName: event.defaultWhatsappTemplate || null,
      eventName: event.name,
    });

    await db.insert(leadWarmingMessages).values({
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      contactId: contact.id,
      eventId: event.id || null,
      channel: 'whatsapp',
      body: message.body,
      templateUsed: event.defaultWhatsappTemplate || null,
      aiGenerated: campaign.aiGenerateMessages,
      aiModel: message.model || null,
      status: 'queued',
      eventName: event.name,
      personalizedFor: event.name,
    });

    result.messagesQueued++;
  }

  // Update schedule (cooldown tracking)
  const cooldownDays = campaign.cooldownDays || 7;
  await db.insert(leadWarmingSchedule)
    .values({
      tenantId: campaign.tenantId,
      contactId: contact.id,
      campaignId: campaign.id,
      lastMessageAt: new Date(),
      nextEligibleAt: new Date(Date.now() + cooldownDays * 86400000),
      messagesThisMonth: 1,
      totalMessages: 1,
    })
    .onConflictDoUpdate({
      target: [leadWarmingSchedule.contactId, leadWarmingSchedule.campaignId],
      set: {
        lastMessageAt: new Date(),
        nextEligibleAt: new Date(Date.now() + cooldownDays * 86400000),
        messagesThisMonth: sql`${leadWarmingSchedule.messagesThisMonth} + 1`,
        totalMessages: sql`${leadWarmingSchedule.totalMessages} + 1`,
        updatedAt: new Date(),
      },
    });

  // Update campaign stats
  await db.update(leadWarmingCampaigns)
    .set({ totalSent: sql`${leadWarmingCampaigns.totalSent} + 1`, updatedAt: new Date() })
    .where(eq(leadWarmingCampaigns.id, campaign.id));
}

// ── Birthday Campaigns ────────────────────────────────────────────────────

async function processBirthdayCampaigns(
  result: WarmingResult,
  todayMonth: number,
  todayDay: number,
): Promise<void> {
  // Find campaigns that include birthdays
  const birthdayCampaigns = await db.select()
    .from(leadWarmingCampaigns)
    .where(and(
      eq(leadWarmingCampaigns.status, 'active'),
      eq(leadWarmingCampaigns.includeBirthdays, true)
    ));

  for (const campaign of birthdayCampaigns) {
    try {
      // Find contacts with birthday today
      const birthdayContacts = await db.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        companyName: contacts.companyId,
        leadStatus: contacts.leadStatus,
        tags: contacts.tags,
        birthday: contacts.birthday,
        assignedTo: contacts.assignedTo,
        doNotContact: contacts.doNotContact,
      })
      .from(contacts)
      .where(and(
        eq(contacts.tenantId, campaign.tenantId),
        or(eq(contacts.doNotContact, false), isNull(contacts.doNotContact)),
        sql`EXTRACT(MONTH FROM ${contacts.birthday}) = ${todayMonth}`,
        sql`EXTRACT(DAY FROM ${contacts.birthday}) = ${todayDay}`,
      ))
      .limit(200);

      const birthdayEvent = {
        id: null,
        name: 'Birthday',
        eventType: 'birthday',
        aiPromptHint: 'Generate a warm, personalized birthday greeting for a business contact. Be genuine and friendly.',
        defaultEmailSubject: 'Happy Birthday! 🎂 Wishing you a wonderful day',
        defaultWhatsappTemplate: null,
      };

      for (const contact of birthdayContacts) {
        try {
          await sendWarmingMessage(campaign, contact as ContactToWarm, birthdayEvent, result);
        } catch (err: any) {
          result.errors.push(`Birthday for ${contact.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`Birthday campaign ${campaign.id}: ${err.message}`);
    }
  }
}

// ── AI Message Generation ─────────────────────────────────────────────────

interface GeneratedMessage {
  subject: string;
  body: string;
  model?: string;
}

async function generateAIMessage(
  campaign: any,
  contact: ContactToWarm,
  event: any,
): Promise<GeneratedMessage> {
  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'there';
  const companyInfo = contact.companyName ? ` from ${contact.companyName}` : '';

  const tone = campaign.aiTone || 'warm_professional';
  const toneDescriptions: Record<string, string> = {
    warm_professional: 'warm yet professional',
    casual_friendly: 'casual and friendly, like a colleague',
    formal: 'formal and respectful',
    festive: 'festive and joyful, celebratory tone',
  };

  const systemPrompt = `You are a CRM system generating personalized warm messages for business contacts.
Generate a SHORT, GENUINE message (2-4 sentences max for WhatsApp, 3-5 sentences for email).
Tone: ${toneDescriptions[tone] || 'warm yet professional'}
Language: ${campaign.aiLanguage || 'en'}

RESPOND WITH JSON ONLY:
{"subject": "<email subject line>", "body": "<message body>"}

Rules:
- Address the contact by first name
- Reference the occasion naturally
- Keep it personal, NOT salesy
- No links or CTAs in festival greetings
- If it's a birthday, make it personal
- Sign off with the business name, not a person's name`;

  const userPrompt = `Generate a ${event.name} greeting for:
- Contact: ${contactName}${companyInfo}
- Occasion: ${event.name} (${event.eventType})
- Hint: ${event.aiPromptHint || 'Generate a warm greeting'}
- Lead Status: ${contact.leadStatus || 'lead'}`;

  try {
    const response = await chat({
      tenantId: campaign.tenantId,
      userId: null,
      action: 'lead_warming_message_gen',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 256,
      temperature: 0.7, // Slightly creative for messages
      entityType: 'lead_warming_message',
      entityId: contact.id,
    });

    const parsed = parseMessageResponse(response.text);
    return {
      subject: parsed.subject || event.defaultEmailSubject || `${event.name} Greetings!`,
      body: parsed.body || getDefaultMessage(contact, event).body,
      model: response.model,
    };
  } catch (err: any) {
    console.warn('[lead-warming] AI message generation failed, using default:', err.message);
    return getDefaultMessage(contact, event);
  }
}

function parseMessageResponse(raw: string): { subject: string; body: string } {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    return { subject: parsed.subject || '', body: parsed.body || '' };
  } catch (e) {
    console.warn('[LeadWarming] Failed to parse AI response as JSON, using raw text:', e);
    return { subject: '', body: cleaned };
  }
}

function getDefaultMessage(contact: ContactToWarm, event: any): GeneratedMessage {
  const name = contact.firstName || 'there';
  const templates: Record<string, string> = {
    'Diwali': `Hi ${name},\n\nWishing you a very Happy Diwali! May this festival of lights bring prosperity and joy to you and your family.\n\nWarm regards`,
    'Christmas': `Hi ${name},\n\nMerry Christmas! Wishing you joy, peace, and a wonderful holiday season.\n\nBest wishes`,
    'New Year': `Hi ${name},\n\nHappy New Year! Here's to a fantastic year ahead filled with success and new opportunities.\n\nCheers`,
    'Holi': `Hi ${name},\n\nHappy Holi! May your life be as colorful and joyful as this festival.\n\nWarm regards`,
    'Birthday': `Hi ${name},\n\nHappy Birthday! Wishing you an amazing day filled with joy and celebration. Here's to another wonderful year ahead!\n\nBest wishes`,
  };

  const body = templates[event.name] ||
    `Hi ${name},\n\nWishing you a wonderful ${event.name}! Hope you have a great time celebrating.\n\nBest regards`;

  return {
    subject: event.defaultEmailSubject || `Happy ${event.name}!`,
    body,
  };
}

// ── Email Template Wrapper ────────────────────────────────────────────────

function wrapInEmailTemplate(body: string, contact: ContactToWarm): string {
  const unsubLink = `{{UNSUBSCRIBE_URL}}`;
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
  <div style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
    ${body.replace(/\n/g, '<br>')}
  </div>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;">
  <p style="font-size: 11px; color: #9ca3af; text-align: center;">
    You received this because you're a valued connection.
    <a href="${unsubLink}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a>
  </p>
</div>`;
}

// ── Seed System Events ────────────────────────────────────────────────────

/**
 * Seed the global festival events into the database.
 * Called during initial setup or migration.
 */
export async function seedSystemEvents(): Promise<number> {
  let inserted = 0;

  for (const festival of SYSTEM_FESTIVALS) {
    try {
      await db.insert(leadWarmingEvents)
        .values({
          tenantId: null as any, // System events have no tenant
          name: festival.name,
          eventType: festival.eventType,
          recurrence: 'yearly',
          eventMonth: festival.eventMonth,
          eventDay: festival.eventDay,
          sendDaysBefore: 0,
          sendHour: 9,
          channels: ['email', 'whatsapp'],
          defaultEmailSubject: festival.defaultEmailSubject,
          defaultWhatsappTemplate: festival.defaultWhatsappTemplate || null,
          aiPromptHint: festival.aiPromptHint,
          isActive: true,
          isSystem: true,
          region: festival.region,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err: any) {
      // Skip duplicates
      console.warn(`[lead-warming] Seed skipped ${festival.name}:`, err.message);
    }
  }

  console.log(`[lead-warming] Seeded ${inserted} system events`);
  return inserted;
}

// ── Monthly Reset ─────────────────────────────────────────────────────────

/**
 * Reset monthly counters for all schedule entries.
 * Called on the 1st of each month by cron.
 */
export async function resetMonthlyCounters(): Promise<void> {
  await db.update(leadWarmingSchedule)
    .set({ messagesThisMonth: 0, updatedAt: new Date() })
    .where(sql`1=1`);
  console.log('[lead-warming] Monthly counters reset');
}

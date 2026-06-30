/**
 * GET  /api/tenant/lead-warming/events — List available events (system + tenant custom)
 * POST /api/tenant/lead-warming/events — Create a custom event
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { db } from '@/drizzle/db';
import { leadWarmingEvents } from '@/drizzle/schema/lead-warming';
import { eq, and, or, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Get system events (tenantId is null) + tenant-specific events
    const events = await db.select()
      .from(leadWarmingEvents)
      .where(and(
        eq(leadWarmingEvents.isActive, true),
        or(
          isNull(leadWarmingEvents.tenantId),
          eq(leadWarmingEvents.tenantId, ctx.tenantId)
        )
      ))
      .orderBy(leadWarmingEvents.eventMonth, leadWarmingEvents.eventDay);

    return NextResponse.json({ data: events });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await req.json();
    const {
      name, description, event_type, recurrence,
      event_month, event_day, event_date,
      send_days_before, send_hour, channels,
      default_email_subject, default_email_body,
      default_whatsapp_template, ai_prompt_hint, region,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Event name is required' }, { status: 400 });
    }
    if (!event_month || !event_day) {
      return NextResponse.json({ error: 'event_month and event_day are required' }, { status: 400 });
    }

    const [event] = await db.insert(leadWarmingEvents)
      .values({
        tenantId: ctx.tenantId,
        name: name.trim(),
        description: description || null,
        eventType: event_type || 'custom',
        recurrence: recurrence || 'yearly',
        eventMonth: event_month,
        eventDay: event_day,
        eventDate: event_date ? new Date(event_date) : null,
        sendDaysBefore: send_days_before ?? 0,
        sendHour: send_hour ?? 9,
        channels: channels || ['email', 'whatsapp'],
        defaultEmailSubject: default_email_subject || null,
        defaultEmailBody: default_email_body || null,
        defaultWhatsappTemplate: default_whatsapp_template || null,
        aiPromptHint: ai_prompt_hint || null,
        isActive: true,
        isSystem: false,
        region: region || null,
      })
      .returning();

    return NextResponse.json({ ok: true, data: event }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

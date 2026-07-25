import { db } from '@/drizzle/db';
import { meetings, integrations } from '@/drizzle/schema';
import { eq, and, isNull, gte, lte } from 'drizzle-orm';
import { createGoogleCalendarProvider } from './google';
import { createOutlookCalendarProvider } from './outlook';
import type { CalendarProvider, CalendarEvent, SyncResult, TokenSet } from './types';

const PROVIDERS = {
  google: createGoogleCalendarProvider,
  outlook: createOutlookCalendarProvider,
} as const;

export function getProvider(type: 'google' | 'outlook'): CalendarProvider {
  const factory = PROVIDERS[type];
  if (!factory) throw new Error(`Unknown calendar provider: ${type}`);
  return factory();
}

export async function getIntegrationConfig(tenantId: string, providerType: 'google' | 'outlook') {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.tenantId, tenantId),
        eq(integrations.type, providerType),
        eq(integrations.isActive, true),
        isNull(integrations.deletedAt)
      )
    )
    .limit(1);

  return integration || null;
}

export async function saveIntegrationConfig(
  tenantId: string,
  userId: string,
  providerType: 'google' | 'outlook',
  tokens: TokenSet,
  calendarId?: string
) {
  const config = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt?.toISOString(),
    calendarId: calendarId || 'primary',
    syncEnabled: true,
    lastSyncAt: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.type, providerType),
          isNull(integrations.deletedAt)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(integrations)
        .set({
          config,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, existing.id));
    } else {
      await tx.insert(integrations).values({
        tenantId,
        userId,
        type: providerType,
        name: providerType === 'google' ? 'Google Calendar' : 'Outlook Calendar',
        config,
        isActive: true,
      });
    }
  });
}

export async function syncCalendarEvents(
  tenantId: string,
  userId: string,
  providerType: 'google' | 'outlook',
  from: Date,
  to: Date
): Promise<SyncResult> {
  const integration = await getIntegrationConfig(tenantId, providerType);
  if (!integration) throw new Error('Calendar integration not configured');

  const config = integration.config as Record<string, unknown>;
  let accessToken = config.accessToken as string;

  // Refresh token if expired
  if (config.expiresAt && new Date(config.expiresAt as string) < new Date()) {
    const provider = getProvider(providerType);
    const tokens = await provider.refreshToken(config.refreshToken as string);
    accessToken = tokens.accessToken;
    await saveIntegrationConfig(tenantId, userId, providerType, tokens, config.calendarId as string);
  }

  const provider = getProvider(providerType);
  const externalEvents = await provider.listEvents(accessToken, from, to);

  const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: [] };

  // Get existing meetings in the time range
  const existingMeetings = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.tenantId, tenantId),
        gte(meetings.startTime, from),
        lte(meetings.startTime, to),
        isNull(meetings.deletedAt)
      )
    );

  // Map external events by external_id
  const existingByExternal = new Map(
    existingMeetings
      .filter(m => m.externalId)
      .map(m => [m.externalId, m])
  );

  // Sync events + integration config atomically
  try {
    await db.transaction(async (tx) => {
      for (const event of externalEvents) {
        const existing = existingByExternal.get(event.externalId!);
        if (existing) {
          await tx.update(meetings)
            .set({
              title: event.title,
              description: event.description || null,
              startTime: event.startTime,
              endTime: event.endTime || null,
              location: event.location || null,
              meetingUrl: event.meetingUrl || null,
              updatedAt: new Date(),
            })
            .where(eq(meetings.id, existing.id));
          result.updated++;
        } else {
          await tx.insert(meetings).values({
            tenantId,
            userId,
            title: event.title,
            description: event.description || null,
            startTime: event.startTime,
            endTime: event.endTime || null,
            location: event.location || null,
            meetingUrl: event.meetingUrl || null,
            status: 'scheduled',
            externalId: event.externalId,
            syncProvider: providerType,
            syncDirection: 'inbound',
            syncedAt: new Date(),
          });
          result.created++;
        }
      }

      // Update integration config
      const [existing] = await tx
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.tenantId, tenantId), eq(integrations.type, providerType), isNull(integrations.deletedAt)))
        .limit(1);

      const integrationConfig = {
        accessToken,
        refreshToken: config.refreshToken as string,
        expiresAt: config.expiresAt ? new Date(config.expiresAt as string).toISOString() : undefined,
        calendarId: config.calendarId || 'primary',
        syncEnabled: true,
        lastSyncAt: new Date().toISOString(),
      };

      if (existing) {
        await tx.update(integrations)
          .set({ config: integrationConfig, isActive: true, updatedAt: new Date() })
          .where(eq(integrations.id, existing.id));
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Transaction failed: ${message}`);
  }

  return result;
}

export async function pushMeetingToCalendar(
  tenantId: string,
  meetingId: string,
  providerType: 'google' | 'outlook'
): Promise<string | null> {
  const integration = await getIntegrationConfig(tenantId, providerType);
  if (!integration) throw new Error('Calendar integration not configured');

  const config = integration.config as Record<string, unknown>;
  let accessToken = config.accessToken as string;

  // Refresh if needed
  if (config.expiresAt && new Date(config.expiresAt as string) < new Date()) {
    const provider = getProvider(providerType);
    const tokens = await provider.refreshToken(config.refreshToken as string);
    accessToken = tokens.accessToken;
  }

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);

  if (!meeting) throw new Error('Meeting not found');

  const provider = getProvider(providerType);
  const event: CalendarEvent = {
    externalId: meeting.externalId || undefined,
    title: meeting.title,
    description: meeting.description || undefined,
    startTime: meeting.startTime,
    endTime: meeting.endTime || undefined,
    location: meeting.location || undefined,
    meetingUrl: meeting.meetingUrl || undefined,
  };

  let externalId: string;
  if (meeting.externalId) {
    await provider.updateEvent(accessToken, meeting.externalId, event);
    externalId = meeting.externalId;
  } else {
    externalId = await provider.createEvent(accessToken, event);
  }

  // Update meeting with sync info
  await db
    .update(meetings)
    .set({
      externalId,
      syncProvider: providerType,
      syncDirection: 'outbound',
      syncedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId));

  return externalId;
}

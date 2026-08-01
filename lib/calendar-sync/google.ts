import type { CalendarProvider, CalendarEvent, TokenSet } from './types';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export function createGoogleCalendarProvider(): CalendarProvider {
  return {
    name: 'Google Calendar',
    type: 'google',

    getAuthUrl(state: string): string {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
        redirect_uri: getRedirectUri(),
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
          redirect_uri: redirectUri || getRedirectUri(),
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google token exchange failed: ${err}`);
      }

      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        scope: data.scope,
      };
    },

    async refreshToken(refreshToken: string): Promise<TokenSet> {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error('Google token refresh failed');
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      };
    },

    async listEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]> {
      const params = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error('Failed to list Google Calendar events');
      const data = await res.json();

      return (data.items || []).map((item: Record<string, unknown>) => ({
        externalId: item.id as string,
        title: (item.summary as string) || 'Untitled',
        description: item.description as string || undefined,
        startTime: new Date((item.start as Record<string, string>).dateTime || (item.start as Record<string, string>).date || ''),
        endTime: new Date((item.end as Record<string, string>).dateTime || (item.end as Record<string, string>).date || ''),
        location: item.location as string || undefined,
        meetingUrl: extractMeetUrl(item.description as string || ''),
        attendees: ((item.attendees as Array<Record<string, string>>) || []).map(a => a.email).filter(Boolean),
      }));
    },

    async createEvent(accessToken: string, event: CalendarEvent): Promise<string> {
      const body: Record<string, unknown> = {
        summary: event.title,
        description: event.description || '',
        start: {
          dateTime: event.startTime.toISOString(),
          timeZone: event.timezone || 'UTC',
        },
        end: {
          dateTime: event.endTime ? event.endTime.toISOString() : new Date(event.startTime.getTime() + 3600000).toISOString(),
          timeZone: event.timezone || 'UTC',
        },
      };

      if (event.location) body.location = event.location;
      if (event.attendees?.length) {
        body.attendees = event.attendees.map(email => ({ email }));
      }

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error('Failed to create Google Calendar event');
      const data = await res.json();
      return data.id;
    },

    async updateEvent(accessToken: string, externalId: string, event: CalendarEvent): Promise<void> {
      const body: Record<string, unknown> = {
        summary: event.title,
        description: event.description || '',
        start: {
          dateTime: event.startTime.toISOString(),
          timeZone: event.timezone || 'UTC',
        },
        end: {
          dateTime: event.endTime ? event.endTime.toISOString() : new Date(event.startTime.getTime() + 3600000).toISOString(),
          timeZone: event.timezone || 'UTC',
        },
      };

      if (event.location) body.location = event.location;

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${externalId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error('Failed to update Google Calendar event');
    },

    async deleteEvent(accessToken: string, externalId: string): Promise<void> {
      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error('Failed to delete Google Calendar event');
    },
  };
}

function getRedirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/calendar-sync/google/callback`;
}

function extractMeetUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
  return match?.[0];
}

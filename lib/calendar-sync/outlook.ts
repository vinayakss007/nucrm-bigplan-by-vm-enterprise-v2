import type { CalendarProvider, CalendarEvent, TokenSet } from './types';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_GRAPH_API = 'https://graph.microsoft.com/v1.0';
const MS_SCOPES = [
  'Calendars.ReadWrite',
  'User.Read',
].join(' ');

export function createOutlookCalendarProvider(): CalendarProvider {
  return {
    name: 'Outlook Calendar',
    type: 'outlook',

    getAuthUrl(state: string): string {
      const params = new URLSearchParams({
        client_id: process.env.OUTLOOK_CALENDAR_CLIENT_ID || '',
        redirect_uri: getRedirectUri(),
        response_type: 'code',
        scope: MS_SCOPES,
        state,
      });
      return `${MS_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
      const res = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.OUTLOOK_CALENDAR_CLIENT_ID || '',
          client_secret: process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || '',
          redirect_uri: redirectUri || getRedirectUri(),
          grant_type: 'authorization_code',
        }),
      });

      if (!res.ok) throw new Error('Microsoft token exchange failed');
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        scope: data.scope,
      };
    },

    async refreshToken(refreshToken: string): Promise<TokenSet> {
      const res = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.OUTLOOK_CALENDAR_CLIENT_ID || '',
          client_secret: process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: MS_SCOPES,
        }),
      });

      if (!res.ok) throw new Error('Microsoft token refresh failed');
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      };
    },

    async listEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]> {
      const filter = `start/dateTime ge '${from.toISOString()}' and end/dateTime le '${to.toISOString()}'`;
      const params = new URLSearchParams({
        $filter: filter,
        $orderby: 'start/dateTime',
        $top: '250',
      });

      const res = await fetch(`${MS_GRAPH_API}/me/calendarView?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.body-type="html"',
        },
      });

      if (!res.ok) throw new Error('Failed to list Outlook events');
      const data = await res.json();

      return (data.value || []).map((item: Record<string, unknown>) => ({
        externalId: item.id as string,
        title: (item.subject as string) || 'Untitled',
        description: (item.bodyPreview as string) || undefined,
        startTime: new Date((item.start as Record<string, string>).dateTime || ''),
        endTime: new Date((item.end as Record<string, string>).dateTime || ''),
        location: (item.location as Record<string, string>)?.displayName || undefined,
        attendees: ((item.attendees as Array<Record<string, Record<string, string>>>) || []).map(a => a.emailAddress?.address).filter(Boolean),
      }));
    },

    async createEvent(accessToken: string, event: CalendarEvent): Promise<string> {
      const body: Record<string, unknown> = {
        subject: event.title,
        body: { contentType: 'HTML', content: event.description || '' },
        start: {
          dateTime: event.startTime.toISOString(),
          timeZone: event.timezone || 'UTC',
        },
        end: {
          dateTime: event.endTime ? event.endTime.toISOString() : new Date(event.startTime.getTime() + 3600000).toISOString(),
          timeZone: event.timezone || 'UTC',
        },
      };

      if (event.location) body.location = { displayName: event.location };
      if (event.attendees?.length) {
        body.attendees = event.attendees.map(email => ({
          emailAddress: { address: email },
          type: 'Required',
        }));
      }

      const res = await fetch(`${MS_GRAPH_API}/me/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to create Outlook event');
      const data = await res.json();
      return data.id;
    },

    async updateEvent(accessToken: string, externalId: string, event: CalendarEvent): Promise<void> {
      const body: Record<string, unknown> = {
        subject: event.title,
        body: { contentType: 'HTML', content: event.description || '' },
        start: {
          dateTime: event.startTime.toISOString(),
          timeZone: event.timezone || 'UTC',
        },
        end: {
          dateTime: event.endTime ? event.endTime.toISOString() : new Date(event.startTime.getTime() + 3600000).toISOString(),
          timeZone: event.timezone || 'UTC',
        },
      };

      if (event.location) body.location = { displayName: event.location };

      const res = await fetch(`${MS_GRAPH_API}/me/events/${externalId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to update Outlook event');
    },

    async deleteEvent(accessToken: string, externalId: string): Promise<void> {
      const res = await fetch(`${MS_GRAPH_API}/me/events/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error('Failed to delete Outlook event');
    },
  };
}

function getRedirectUri(): string {
  return process.env.OUTLOOK_CALENDAR_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/calendar-sync/outlook/callback`;
}

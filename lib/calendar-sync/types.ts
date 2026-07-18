export interface CalendarEvent {
  externalId?: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  location?: string;
  meetingUrl?: string;
  attendees?: string[];
  recurrence?: string;
  timezone?: string;
}

export interface CalendarProvider {
  name: string;
  type: 'google' | 'outlook';

  getAuthUrl(state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken(refreshToken: string): Promise<TokenSet>;
  listEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]>;
  createEvent(accessToken: string, event: CalendarEvent): Promise<string>;
  updateEvent(accessToken: string, externalId: string, event: CalendarEvent): Promise<void>;
  deleteEvent(accessToken: string, externalId: string): Promise<void>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

export interface CalendarSyncConfig {
  provider: 'google' | 'outlook';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  calendarId?: string;
  syncEnabled: boolean;
  lastSyncAt?: Date;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

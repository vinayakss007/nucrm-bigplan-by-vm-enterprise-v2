import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchError(message: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    text: () => Promise.resolve(message),
  });
}

describe.each([
  { name: 'Google', factory: 'createGoogleCalendarProvider', mod: 'google',
    envPrefix: 'GOOGLE_CALENDAR',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    calendarUrl: 'https://www.googleapis.com/calendar/v3',
  },
  { name: 'Outlook', factory: 'createOutlookCalendarProvider', mod: 'outlook',
    envPrefix: 'OUTLOOK_CALENDAR',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    calendarUrl: 'https://graph.microsoft.com/v1.0',
  },
])('$name Calendar Provider', ({ name: _name, factory, mod, envPrefix, authUrl, tokenUrl, calendarUrl }) => {
  beforeEach(() => {
    process.env[`${envPrefix}_CLIENT_ID`] = 'test-client-id';
    process.env[`${envPrefix}_CLIENT_SECRET`] = 'test-client-secret';
    process.env[`${envPrefix}_REDIRECT_URI`] = `http://test.app/api/calendar-sync/${mod}/callback`;
    process.env.NEXT_PUBLIC_APP_URL = 'http://test.app';
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env[`${envPrefix}_CLIENT_ID`];
    delete process.env[`${envPrefix}_CLIENT_SECRET`];
    delete process.env[`${envPrefix}_REDIRECT_URI`];
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('getAuthUrl returns correct URL', async () => {
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const url = provider.getAuthUrl('state-123');
    expect(url).toContain(authUrl);
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('state=state-123');
    expect(url).toContain('redirect_uri=');
  });

  it('exchangeCode returns tokens on success', async () => {
    mockFetchOnce(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'read' });
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const tokens = await provider.exchangeCode('code-123', 'http://redirect');
    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it('exchangeCode throws on failure', async () => {
    mockFetchError('Bad request');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.exchangeCode('bad', 'http://x')).rejects.toThrow();
  });

  it('refreshToken returns new tokens', async () => {
    mockFetchOnce(200, { access_token: 'at-2', expires_in: 7200 });
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const tokens = await provider.refreshToken('rt-old');
    expect(tokens.accessToken).toBe('at-2');
    expect(tokens.refreshToken).toBe('rt-old');
  });

  it('refreshToken throws on failure', async () => {
    mockFetchError('Invalid refresh');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.refreshToken('bad')).rejects.toThrow();
  });

  it('listEvents returns mapped events', async () => {
    const items = mod === 'google'
      ? { items: [{ id: 'ev-1', summary: 'Meeting', start: { dateTime: '2026-01-01T10:00:00Z' }, end: { dateTime: '2026-01-01T11:00:00Z' } }] }
      : { value: [{ id: 'ev-1', subject: 'Meeting', start: { dateTime: '2026-01-01T10:00:00Z' }, end: { dateTime: '2026-01-01T11:00:00Z' } }] };
    mockFetchOnce(200, items);
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const events = await provider.listEvents('token', new Date('2026-01-01'), new Date('2026-01-02'));
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe('ev-1');
    expect(events[0].title).toBe('Meeting');
  });

  it('listEvents throws on failure', async () => {
    mockFetchError('API error');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.listEvents('t', new Date(), new Date())).rejects.toThrow();
  });

  it('createEvent returns event ID', async () => {
    mockFetchOnce(200, { id: 'ev-new' });
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const id = await provider.createEvent('token', {
      title: 'New Event', startTime: new Date(), timezone: 'UTC',
    });
    expect(id).toBe('ev-new');
  });

  it('createEvent throws on failure', async () => {
    mockFetchError('Create failed');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.createEvent('t', { title: 'X', startTime: new Date() })).rejects.toThrow();
  });

  it('updateEvent succeeds', async () => {
    mockFetchOnce(200, {});
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.updateEvent('token', 'ev-1', { title: 'Updated', startTime: new Date() })).resolves.not.toThrow();
  });

  it('updateEvent throws on failure', async () => {
    mockFetchError('Update failed');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.updateEvent('t', 'ev-1', { title: 'X', startTime: new Date() })).rejects.toThrow();
  });

  it('deleteEvent succeeds', async () => {
    mockFetchOnce(204, {});
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.deleteEvent('token', 'ev-1')).resolves.not.toThrow();
  });

  it('deleteEvent throws on failure', async () => {
    mockFetchError('Delete failed');
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    await expect(provider.deleteEvent('t', 'ev-1')).rejects.toThrow();
  });

  it('uses default redirect URI when env var not set', async () => {
    delete process.env[`${envPrefix}_REDIRECT_URI`];
    const { [factory]: createProvider } = await import(`@/lib/calendar-sync/${mod}`);
    const provider = createProvider();
    const url = provider.getAuthUrl('x');
    expect(url).toContain(encodeURIComponent('http://test.app'));
  });
});

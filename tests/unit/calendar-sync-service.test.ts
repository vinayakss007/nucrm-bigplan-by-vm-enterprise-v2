import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle-orm operators before anything else
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ type: 'isNull', args })),
  gte: vi.fn((...args: unknown[]) => ({ type: 'gte', args })),
  lte: vi.fn((...args: unknown[]) => ({ type: 'lte', args })),
  sql: vi.fn(),
}));

// Mock the database
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    transaction: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  meetings: { id: 'meetings.id', tenantId: 'meetings.tenantId', startTime: 'meetings.startTime', deletedAt: 'meetings.deletedAt', externalId: 'meetings.externalId' },
  integrations: { id: 'integrations.id', tenantId: 'integrations.tenantId', type: 'integrations.type', isActive: 'integrations.isActive', deletedAt: 'integrations.deletedAt' },
}));

// Mock calendar providers
const mockGoogleProvider = {
  name: 'Google Calendar',
  type: 'google' as const,
  getAuthUrl: vi.fn().mockReturnValue('https://google.com/auth'),
  exchangeCode: vi.fn(),
  refreshToken: vi.fn(),
  listEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};

const mockOutlookProvider = {
  name: 'Outlook Calendar',
  type: 'outlook' as const,
  getAuthUrl: vi.fn().mockReturnValue('https://outlook.com/auth'),
  exchangeCode: vi.fn(),
  refreshToken: vi.fn(),
  listEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};

vi.mock('@/lib/calendar-sync/google', () => ({
  createGoogleCalendarProvider: vi.fn(() => mockGoogleProvider),
}));

vi.mock('@/lib/calendar-sync/outlook', () => ({
  createOutlookCalendarProvider: vi.fn(() => mockOutlookProvider),
}));

vi.mock('@/lib/capture-error', () => ({
  captureError: vi.fn(),
}));

function setupDbChain(result: unknown[] = []) {
  mockLimit.mockResolvedValue(result);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}



describe('Calendar Sync Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('getProvider', () => {
    it('returns a Google provider for type "google"', async () => {
      const { getProvider } = await import('@/lib/calendar-sync/service');
      const provider = getProvider('google');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Google Calendar');
      expect(provider.type).toBe('google');
    });

    it('returns an Outlook provider for type "outlook"', async () => {
      const { getProvider } = await import('@/lib/calendar-sync/service');
      const provider = getProvider('outlook');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Outlook Calendar');
      expect(provider.type).toBe('outlook');
    });

    it('throws an error for unknown provider type', async () => {
      const { getProvider } = await import('@/lib/calendar-sync/service');
      expect(() => getProvider('yahoo' as never)).toThrow('Unknown calendar provider: yahoo');
    });
  });

  describe('getIntegrationConfig', () => {
    it('returns integration config when found', async () => {
      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: { accessToken: 'token-123', refreshToken: 'refresh-456' },
      };

      setupDbChain([mockIntegration]);

      const { getIntegrationConfig } = await import('@/lib/calendar-sync/service');
      const result = await getIntegrationConfig('tenant-1', 'google');

      expect(result).toEqual(mockIntegration);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('returns null when no integration config found', async () => {
      setupDbChain([]);

      const { getIntegrationConfig } = await import('@/lib/calendar-sync/service');
      const result = await getIntegrationConfig('tenant-1', 'google');

      expect(result).toBeNull();
    });
  });

  describe('saveIntegrationConfig', () => {
    it('updates existing integration config', async () => {
      const { db } = await import('@/drizzle/db');

      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
        const txSelectLimit = vi.fn().mockResolvedValue([{ id: 'existing-1' }]);
        const txSelectWhere = vi.fn().mockReturnValue({ limit: txSelectLimit });
        const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });

        const txUpdateWhere = vi.fn().mockResolvedValue([]);
        const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });

        const tx = {
          select: vi.fn().mockReturnValue({ from: txSelectFrom }),
          update: vi.fn().mockReturnValue({ set: txUpdateSet }),
          insert: vi.fn(),
        };
        return fn(tx);
      });

      const { saveIntegrationConfig } = await import('@/lib/calendar-sync/service');

      await saveIntegrationConfig('tenant-1', 'user-1', 'google', {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date('2025-12-31'),
      }, 'cal-123');

      expect(db.transaction).toHaveBeenCalled();
    });

    it('inserts new integration config when none exists', async () => {
      const { db } = await import('@/drizzle/db');

      const mockInsertValues = vi.fn().mockResolvedValue([{}]);
      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
        const txSelectLimit = vi.fn().mockResolvedValue([]);
        const txSelectWhere = vi.fn().mockReturnValue({ limit: txSelectLimit });
        const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });

        const tx = {
          select: vi.fn().mockReturnValue({ from: txSelectFrom }),
          insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
          update: vi.fn(),
        };
        return fn(tx);
      });

      const { saveIntegrationConfig } = await import('@/lib/calendar-sync/service');

      await saveIntegrationConfig('tenant-1', 'user-1', 'outlook', {
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
      });

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('syncCalendarEvents', () => {
    it('syncs events successfully creating new meetings', async () => {
      const { db } = await import('@/drizzle/db');

      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      // First call: getIntegrationConfig - returns integration
      setupDbChain([mockIntegration]);

      const mockEvents = [
        {
          externalId: 'ext-1',
          title: 'Team Standup',
          description: 'Daily standup',
          startTime: new Date('2025-01-15T09:00:00Z'),
          endTime: new Date('2025-01-15T09:30:00Z'),
          location: 'Zoom',
        },
      ];

      mockGoogleProvider.listEvents.mockResolvedValue(mockEvents);

      // For the existing meetings query (second select call - no limit chain)
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // getIntegrationConfig
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        // existingMeetings query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

      const txInsertValues = vi.fn().mockResolvedValue([{}]);
      const txUpdateWhere = vi.fn().mockResolvedValue([]);
      const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
      const txSelectLimit = vi.fn().mockResolvedValue([{ id: 'int-1' }]);
      const txSelectWhere = vi.fn().mockReturnValue({ limit: txSelectLimit });
      const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });

      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
        const tx = {
          select: vi.fn().mockReturnValue({ from: txSelectFrom }),
          insert: vi.fn().mockReturnValue({ values: txInsertValues }),
          update: vi.fn().mockReturnValue({ set: txUpdateSet }),
        };
        return fn(tx);
      });

      const { syncCalendarEvents } = await import('@/lib/calendar-sync/service');

      const from = new Date('2025-01-01');
      const to = new Date('2025-01-31');
      const result = await syncCalendarEvents('tenant-1', 'user-1', 'google', from, to);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockGoogleProvider.listEvents).toHaveBeenCalledWith('valid-token', from, to);
    });

    it('refreshes token when access token is expired', async () => {
      const { db } = await import('@/drizzle/db');

      const expiredConfig = {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // expired 1 hour ago
        calendarId: 'primary',
      };

      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: expiredConfig,
      };

      // Mock for getIntegrationConfig and existingMeetings
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

      mockGoogleProvider.refreshToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockGoogleProvider.listEvents.mockResolvedValue([]);

      // saveIntegrationConfig transaction (refresh triggers it)
      // and syncCalendarEvents transaction
      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
        const txSelectLimit = vi.fn().mockResolvedValue([{ id: 'int-1' }]);
        const txSelectWhere = vi.fn().mockReturnValue({ limit: txSelectLimit });
        const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
        const txUpdateWhere = vi.fn().mockResolvedValue([]);
        const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });

        const tx = {
          select: vi.fn().mockReturnValue({ from: txSelectFrom }),
          insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
          update: vi.fn().mockReturnValue({ set: txUpdateSet }),
        };
        return fn(tx);
      });

      const { syncCalendarEvents } = await import('@/lib/calendar-sync/service');

      const from = new Date('2025-01-01');
      const to = new Date('2025-01-31');
      const result = await syncCalendarEvents('tenant-1', 'user-1', 'google', from, to);

      expect(mockGoogleProvider.refreshToken).toHaveBeenCalledWith('valid-refresh');
      expect(mockGoogleProvider.listEvents).toHaveBeenCalledWith('new-access-token', from, to);
      expect(result.errors).toHaveLength(0);
    });

    it('throws error when no integration config found', async () => {
      setupDbChain([]);

      const { syncCalendarEvents } = await import('@/lib/calendar-sync/service');

      await expect(
        syncCalendarEvents('tenant-1', 'user-1', 'google', new Date(), new Date())
      ).rejects.toThrow('Calendar integration not configured');
    });

    it('captures transaction errors in result.errors', async () => {
      const { db } = await import('@/drizzle/db');

      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'outlook',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

      mockOutlookProvider.listEvents.mockResolvedValue([
        { externalId: 'ext-1', title: 'Meeting', startTime: new Date() },
      ]);

      (db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database connection lost'));

      const { syncCalendarEvents } = await import('@/lib/calendar-sync/service');

      const result = await syncCalendarEvents('tenant-1', 'user-1', 'outlook', new Date(), new Date());

      expect(result.errors).toContain('Transaction failed: Database connection lost');
    });

    it('handles provider listEvents error', async () => {
      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      setupDbChain([mockIntegration]);

      mockGoogleProvider.listEvents.mockRejectedValue(new Error('Failed to list Google Calendar events'));

      const { syncCalendarEvents } = await import('@/lib/calendar-sync/service');

      await expect(
        syncCalendarEvents('tenant-1', 'user-1', 'google', new Date(), new Date())
      ).rejects.toThrow('Failed to list Google Calendar events');
    });
  });

  describe('pushMeetingToCalendar', () => {
    it('creates a new event on the provider for a meeting without externalId', async () => {
      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      const mockMeeting = {
        id: 'meeting-1',
        tenantId: 'tenant-1',
        title: 'Client Call',
        description: 'Quarterly review',
        startTime: new Date('2025-01-20T14:00:00Z'),
        endTime: new Date('2025-01-20T15:00:00Z'),
        location: 'Google Meet',
        meetingUrl: 'https://meet.google.com/abc-xyz',
        externalId: null,
      };

      // First select: getIntegrationConfig
      // Second select: get meeting
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMeeting]),
            }),
          }),
        };
      });

      mockGoogleProvider.createEvent.mockResolvedValue('new-ext-id-123');

      const mockUpdateWhere = vi.fn().mockResolvedValue([]);
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
      mockUpdate.mockReturnValue({ set: mockUpdateSet });

      const { pushMeetingToCalendar } = await import('@/lib/calendar-sync/service');

      const result = await pushMeetingToCalendar('tenant-1', 'meeting-1', 'google');

      expect(result).toBe('new-ext-id-123');
      expect(mockGoogleProvider.createEvent).toHaveBeenCalledWith('valid-token', expect.objectContaining({
        title: 'Client Call',
        description: 'Quarterly review',
      }));
    });

    it('updates an existing event on the provider when externalId exists', async () => {
      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'outlook',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      const mockMeeting = {
        id: 'meeting-2',
        tenantId: 'tenant-1',
        title: 'Updated Meeting',
        description: null,
        startTime: new Date('2025-02-01T10:00:00Z'),
        endTime: new Date('2025-02-01T11:00:00Z'),
        location: null,
        meetingUrl: null,
        externalId: 'existing-ext-id',
      };

      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMeeting]),
            }),
          }),
        };
      });

      mockOutlookProvider.updateEvent.mockResolvedValue(undefined);

      const mockUpdateWhere = vi.fn().mockResolvedValue([]);
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
      mockUpdate.mockReturnValue({ set: mockUpdateSet });

      const { pushMeetingToCalendar } = await import('@/lib/calendar-sync/service');

      const result = await pushMeetingToCalendar('tenant-1', 'meeting-2', 'outlook');

      expect(result).toBe('existing-ext-id');
      expect(mockOutlookProvider.updateEvent).toHaveBeenCalledWith(
        'valid-token',
        'existing-ext-id',
        expect.objectContaining({ title: 'Updated Meeting' })
      );
      expect(mockOutlookProvider.createEvent).not.toHaveBeenCalled();
    });

    it('throws error when no integration config found', async () => {
      setupDbChain([]);

      const { pushMeetingToCalendar } = await import('@/lib/calendar-sync/service');

      await expect(
        pushMeetingToCalendar('tenant-1', 'meeting-1', 'google')
      ).rejects.toThrow('Calendar integration not configured');
    });

    it('throws error when meeting not found', async () => {
      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          calendarId: 'primary',
        },
      };

      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        // meeting not found
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      });

      const { pushMeetingToCalendar } = await import('@/lib/calendar-sync/service');

      await expect(
        pushMeetingToCalendar('tenant-1', 'nonexistent', 'google')
      ).rejects.toThrow('Meeting not found');
    });

    it('refreshes token when expired before pushing', async () => {
      const expiredConfig = {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // expired
        calendarId: 'primary',
      };

      const mockIntegration = {
        id: 'int-1',
        tenantId: 'tenant-1',
        type: 'google',
        isActive: true,
        config: expiredConfig,
      };

      const mockMeeting = {
        id: 'meeting-1',
        tenantId: 'tenant-1',
        title: 'Refresh Test Meeting',
        description: null,
        startTime: new Date('2025-01-20T14:00:00Z'),
        endTime: null,
        location: null,
        meetingUrl: null,
        externalId: null,
      };

      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockIntegration]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMeeting]),
            }),
          }),
        };
      });

      mockGoogleProvider.refreshToken.mockResolvedValue({
        accessToken: 'refreshed-access-token',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockGoogleProvider.createEvent.mockResolvedValue('created-ext-id');

      const mockUpdateWhere = vi.fn().mockResolvedValue([]);
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
      mockUpdate.mockReturnValue({ set: mockUpdateSet });

      const { pushMeetingToCalendar } = await import('@/lib/calendar-sync/service');

      const result = await pushMeetingToCalendar('tenant-1', 'meeting-1', 'google');

      expect(mockGoogleProvider.refreshToken).toHaveBeenCalledWith('valid-refresh');
      expect(mockGoogleProvider.createEvent).toHaveBeenCalledWith(
        'refreshed-access-token',
        expect.objectContaining({ title: 'Refresh Test Meeting' })
      );
      expect(result).toBe('created-ext-id');
    });
  });
});

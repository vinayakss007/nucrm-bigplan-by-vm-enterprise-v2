import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => {
  // Recursive callable proxy: db.select(...).from(...).where(...).set(...).values(...)
  // all work. When awaited, returns an empty array.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeChain(): any {
    const fn = function () { return proxy; };
    const proxy = new Proxy(fn, {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        return makeChain();
      },
    });
    return proxy;
  }
  return { db: makeChain() };
});

vi.mock('@/drizzle/schema', () => ({
  contacts: { tenantId: 't', id: 'id', firstName: 'fn', lastName: 'ln', email: 'e', phone: 'p', companyId: 'ci', leadStatus: 'ls', tags: 'tg', birthday: 'bd', assignedTo: 'at', doNotContact: 'dnc' },
}));

vi.mock('@/drizzle/schema/lead-warming', () => ({
  leadWarmingEvents: { id: 'id', tenantId: 'tid', name: 'n', eventType: 'et', eventMonth: 'em', eventDay: 'ed', isActive: 'ia', isSystem: 'is', sendDaysBefore: 'sdb' },
  leadWarmingCampaigns: { id: 'id', tenantId: 'tid', status: 's', eventIds: 'ei', targetFilter: 'tf', enableEmail: 'ee', enableWhatsapp: 'ew', enableSms: 'es', aiGenerateMessages: 'agm', aiTone: 'at', aiLanguage: 'al', cooldownDays: 'cd', includeBirthdays: 'ib', totalSent: 'ts' },
  leadWarmingMessages: { id: 'id', tenantId: 'tid', campaignId: 'cid', contactId: 'ctid', eventId: 'eid', channel: 'ch', subject: 'sub', body: 'b', templateUsed: 'tu', aiGenerated: 'ag', aiModel: 'am', status: 'st', eventName: 'en', personalizedFor: 'pf' },
  leadWarmingSchedule: { contactId: 'ctid', campaignId: 'cid', optedOut: 'oo', nextEligibleAt: 'nea', lastMessageAt: 'lma', messagesThisMonth: 'mtm', totalMessages: 'tot', updatedAt: 'ua' },
}));

vi.mock('@/lib/ai/gateway', () => ({
  chat: vi.fn().mockResolvedValue({ text: '{"subject":"Hello!","body":"Hi there!"}', model: 'test' }),
}));

vi.mock('@/lib/queue', () => ({
  addJob: vi.fn().mockResolvedValue(undefined),
}));

// Must import after mocks
const { SYSTEM_FESTIVALS, processLeadWarming, seedSystemEvents, resetMonthlyCounters } = await import('@/lib/lead-warming/engine');

describe('lead-warming engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SYSTEM_FESTIVALS', () => {
    it('exports an array of festivals', () => {
      expect(Array.isArray(SYSTEM_FESTIVALS)).toBe(true);
      expect(SYSTEM_FESTIVALS.length).toBeGreaterThan(0);
    });

    it('each festival has required fields', () => {
      for (const f of SYSTEM_FESTIVALS) {
        expect(f.name).toBeDefined();
        expect(f.eventType).toBeDefined();
        expect(f.eventMonth).toBeGreaterThanOrEqual(1);
        expect(f.eventMonth).toBeLessThanOrEqual(12);
        expect(f.eventDay).toBeGreaterThanOrEqual(1);
        expect(f.eventDay).toBeLessThanOrEqual(31);
        expect(f.region).toBeDefined();
        expect(f.aiPromptHint).toBeDefined();
        expect(f.defaultEmailSubject).toBeDefined();
      }
    });

    it('includes major Indian festivals', () => {
      const names = SYSTEM_FESTIVALS.map(f => f.name);
      expect(names).toContain('Diwali');
      expect(names).toContain('Holi');
      expect(names).toContain('Makar Sankranti');
      expect(names).toContain('Raksha Bandhan');
      expect(names).toContain('Ganesh Chaturthi');
      expect(names).toContain('Navratri');
      expect(names).toContain('Onam');
    });

    it('includes global holidays', () => {
      const names = SYSTEM_FESTIVALS.map(f => f.name);
      expect(names).toContain('New Year');
      expect(names).toContain('Christmas');
      expect(names).toContain('Valentine\'s Day');
      expect(names).toContain('Easter');
    });

    it('has valid event types', () => {
      const validTypes = ['festival', 'holiday', 'season', 'custom'];
      for (const f of SYSTEM_FESTIVALS) {
        expect(validTypes).toContain(f.eventType);
      }
    });

    it('has valid regions', () => {
      const validRegions = ['IN', 'US', 'global'];
      for (const f of SYSTEM_FESTIVALS) {
        expect(validRegions).toContain(f.region);
      }
    });

    it('has business season events', () => {
      const names = SYSTEM_FESTIVALS.map(f => f.name);
      expect(names).toContain('Financial Year Start');
      expect(names).toContain('Mid-Year Check-in');
      expect(names).toContain('Year-End Review');
    });
  });

  describe('processLeadWarming', () => {
    it('returns a WarmingResult with correct shape', async () => {
      const result = await processLeadWarming();
      expect(result).toHaveProperty('campaignsProcessed');
      expect(result).toHaveProperty('messagesSent');
      expect(result).toHaveProperty('messagesQueued');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('skippedContacts');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe('seedSystemEvents', () => {
    it('returns a number', async () => {
      const result = await seedSystemEvents();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetMonthlyCounters', () => {
    it('completes without error', async () => {
      await expect(resetMonthlyCounters()).resolves.toBeUndefined();
    });
  });
});

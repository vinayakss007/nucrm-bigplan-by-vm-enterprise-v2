import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema/visitors', () => ({
  visitors: {
    id: 'id', tenantId: 'tenant_id', fingerprintId: 'fingerprint_id',
    identifiedContactId: 'identified_contact_id', firstSeenAt: 'first_seen_at',
    lastSeenAt: 'last_seen_at', totalPageViews: 'total_page_views',
    score: 'score', deletedAt: 'deleted_at',
  },
  pageViews: {
    id: 'id', tenantId: 'tenant_id', visitorId: 'visitor_id',
    url: 'url', title: 'title', referrer: 'referrer',
    durationSeconds: 'duration_seconds', viewedAt: 'viewed_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ['eq', ...args]),
  and: vi.fn((...args: unknown[]) => ['and', ...args]),
  desc: vi.fn((col: unknown) => ['desc', col]),
  sql: vi.fn(),
}));

import { db } from '@/drizzle/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSelect(returnValue: any) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.select as any).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => returnValue),
      })),
    })),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSelectBasic(returnValue: any) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.select as any).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => returnValue),
    })),
  });
}

function mockSelectEmpty() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.select as any).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => []),
    })),
  });
}

function mockInsert() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.insert as any).mockReturnValue({
    values: vi.fn(() => ({
      returning: vi.fn(() => [{ id: 'new-id' }]),
    })),
  });
}

function mockUpdate() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.update as any).mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([])),
    })),
  });
}

describe('scorePageUrl', () => {
  it('scores homepage at 1 point', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/')).toBe(1);
    expect(scorePageUrl('/home')).toBe(1);
  });

  it('scores pricing page at 5 points', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/pricing')).toBe(5);
    expect(scorePageUrl('/pricing/enterprise')).toBe(5);
  });

  it('scores demo page at 10 points', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/demo')).toBe(10);
    expect(scorePageUrl('/demo/request')).toBe(10);
  });

  it('scores features page at 3 points', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/features')).toBe(3);
    expect(scorePageUrl('/features/crm')).toBe(3);
  });

  it('scores docs page at 2 points', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/docs')).toBe(2);
    expect(scorePageUrl('/docs/api')).toBe(2);
  });

  it('scores blog page at 1 point', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/blog')).toBe(1);
    expect(scorePageUrl('/blog/new-feature')).toBe(1);
  });

  it('scores unknown pages at 1 point (default)', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/about')).toBe(1);
    expect(scorePageUrl('/contact')).toBe(1);
  });

  it('matches patterns case-insensitively', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('/DEMO')).toBe(10);
    expect(scorePageUrl('/Pricing')).toBe(5);
  });

  it('returns 1 for empty string', async () => {
    const { scorePageUrl } = await import('@/lib/visitor-tracking');
    expect(scorePageUrl('')).toBe(1);
  });
});

describe('trackPageView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts page view and updates existing visitor', async () => {
    const { db } = await import('@/drizzle/db');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => [
          { id: 'v-1', totalPageViews: 3, score: 10 },
        ]),
      })),
    });
    mockInsert();
    mockUpdate();

    const { trackPageView } = await import('@/lib/visitor-tracking');
    await trackPageView('v-1', '/pricing', 'Pricing', '', 30, 'tenant-1');

    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('does not update when visitor is new (no existing record)', async () => {
    const { db } = await import('@/drizzle/db');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => []),
      })),
    });
    mockInsert();
    mockUpdate();

    const { trackPageView } = await import('@/lib/visitor-tracking');
    await trackPageView('v-new', '/blog', 'Blog', 'google.com', 10, 'tenant-1');

    expect(db.insert).toHaveBeenCalled();
  });
});

describe('identifyVisitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links visitor to contact email', async () => {
    mockUpdate();

    const { identifyVisitor } = await import('@/lib/visitor-tracking');
    const result = await identifyVisitor('v-1', 'test@example.com', 'tenant-1');

    expect(result).toEqual({ identified: true });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('getVisitorScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero score for non-existent visitor', async () => {
    mockSelectBasic([]);

    const { getVisitorScore } = await import('@/lib/visitor-tracking');
    const score = await getVisitorScore('non-existent');

    expect(score).toEqual({ totalScore: 0, pageScore: 0, frequencyBonus: 0, recencyBonus: 0 });
  });

  it('calculates full score with frequency and recency bonuses', async () => {
    const { db } = await import('@/drizzle/db');
    const recentDate = new Date();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'v-1', totalPageViews: 6, score: 20, lastSeenAt: recentDate },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { url: '/pricing' },
            { url: '/demo' },
          ]),
        })),
      });

    const { getVisitorScore } = await import('@/lib/visitor-tracking');
    const score = await getVisitorScore('v-1');

    expect(score.pageScore).toBe(15);
    expect(score.frequencyBonus).toBe(5);
    expect(score.recencyBonus).toBe(3);
    expect(score.totalScore).toBe(23);
  });

  it('no frequency bonus for fewer than 5 visits', async () => {
    const { db } = await import('@/drizzle/db');
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'v-2', totalPageViews: 3, score: 10, lastSeenAt: oldDate },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { url: '/' },
            { url: '/blog' },
          ]),
        })),
      });

    const { getVisitorScore } = await import('@/lib/visitor-tracking');
    const score = await getVisitorScore('v-2');

    expect(score.pageScore).toBe(2);
    expect(score.frequencyBonus).toBe(0);
    expect(score.recencyBonus).toBe(0);
    expect(score.totalScore).toBe(2);
  });

  it('skips recency bonus when lastSeenAt is null', async () => {
    const { db } = await import('@/drizzle/db');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'v-3', totalPageViews: 1, score: 1, lastSeenAt: null },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

    const { getVisitorScore } = await import('@/lib/visitor-tracking');
    const score = await getVisitorScore('v-3');

    expect(score.recencyBonus).toBe(0);
  });
});

describe('getVisitorProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-existent visitor', async () => {
    mockSelectBasic([]);

    const { getVisitorProfile } = await import('@/lib/visitor-tracking');
    const profile = await getVisitorProfile('non-existent');

    expect(profile).toBeNull();
  });

  it('returns full profile with visitor, page views, and score', async () => {
    const { db } = await import('@/drizzle/db');
    const visitorData = { id: 'v-1', totalPageViews: 5, score: 20, lastSeenAt: new Date() };
    const pageViewsData = [
      { url: '/pricing', viewedAt: new Date() },
      { url: '/demo', viewedAt: new Date() },
    ];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [visitorData]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => pageViewsData),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [visitorData]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => pageViewsData),
        })),
      });

    const { getVisitorProfile } = await import('@/lib/visitor-tracking');
    const profile = await getVisitorProfile('v-1');

    expect(profile).not.toBeNull();
    expect(profile!.visitor).toEqual(visitorData);
    expect(profile!.pageViews).toEqual(pageViewsData);
    expect(profile!.score).toBeDefined();
  });
});

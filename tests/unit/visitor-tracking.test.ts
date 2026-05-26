import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'visitor-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/visitors', () => ({
  visitors: {
    id: 'id',
    tenantId: 'tenant_id',
    fingerprintId: 'fingerprint_id',
    identifiedContactId: 'identified_contact_id',
    firstSeenAt: 'first_seen_at',
    lastSeenAt: 'last_seen_at',
    totalPageViews: 'total_page_views',
    score: 'score',
    deletedAt: 'deleted_at',
  },
  pageViews: {
    id: 'id',
    tenantId: 'tenant_id',
    visitorId: 'visitor_id',
    url: 'url',
    title: 'title',
    referrer: 'referrer',
    durationSeconds: 'duration_seconds',
    viewedAt: 'viewed_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => ['desc', col]),
  sql: vi.fn(),
}));

describe('Visitor Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  });

  describe('getVisitorScore', () => {
    it('returns zero score for non-existent visitor', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

      const { getVisitorScore } = await import('@/lib/visitor-tracking');
      const score = await getVisitorScore('non-existent');
      expect(score).toEqual({ totalScore: 0, pageScore: 0, frequencyBonus: 0, recencyBonus: 0 });
    });

    it('calculates frequency bonus for 5+ visits', async () => {
      const { db } = await import('@/drizzle/db');
      const recentDate = new Date(); // within last 24h
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
      // pageScore: pricing(5) + demo(10) = 15
      // frequencyBonus: 5 (6 total views >= 5)
      // recencyBonus: 3 (visited within 24h)
      expect(score.pageScore).toBe(15);
      expect(score.frequencyBonus).toBe(5);
      expect(score.recencyBonus).toBe(3);
      expect(score.totalScore).toBe(23);
    });

    it('no frequency bonus for fewer than 5 visits', async () => {
      const { db } = await import('@/drizzle/db');
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
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
      // pageScore: homepage(1) + blog(1) = 2
      // frequencyBonus: 0 (3 total views < 5)
      // recencyBonus: 0 (last seen 48h ago)
      expect(score.pageScore).toBe(2);
      expect(score.frequencyBonus).toBe(0);
      expect(score.recencyBonus).toBe(0);
      expect(score.totalScore).toBe(2);
    });
  });

  describe('identifyVisitor', () => {
    it('links visitor to contact email', async () => {
      const { identifyVisitor } = await import('@/lib/visitor-tracking');
      const result = await identifyVisitor('v-1', 'test@example.com', 'tenant-1');
      expect(result).toEqual({ identified: true });
    });
  });

  describe('trackPageView', () => {
    it('records a page view and updates visitor', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'v-1', totalPageViews: 3, score: 10 },
          ]),
        })),
      });

      const { trackPageView } = await import('@/lib/visitor-tracking');
      await trackPageView('v-1', '/pricing', 'Pricing', '', 30, 'tenant-1');
      expect(db.insert).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
    });
  });
});

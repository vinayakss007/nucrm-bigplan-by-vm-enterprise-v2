import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  plans: {},
  tenants: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => args),
}));

describe('AI Plan Gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('requireAiFeature', () => {
    it('bypasses check for super admin', async () => {
      const { requireAiFeature } = await import('@/lib/ai/plan-gate');
      const ctx = { isSuperAdmin: true, tenantId: 't1' } as Parameters<typeof requireAiFeature>[0];
      const result = await requireAiFeature(ctx, 'ai_sentiment');
      expect(result).toBeNull();
    });

    it('returns 403 when feature not in plan', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: vi.fn((fn: (r: unknown[]) => unknown) => fn([{ features: ['ai_basic'] }])),
              })),
            })),
          })),
        })),
      });

      const { requireAiFeature } = await import('@/lib/ai/plan-gate');
      const ctx = { isSuperAdmin: false, tenantId: 't1' } as Parameters<typeof requireAiFeature>[0];
      const result = await requireAiFeature(ctx, 'ai_sentiment');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });

    it('returns null when feature is in plan', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: vi.fn((fn: (r: unknown[]) => unknown) => fn([{ features: ['ai_sentiment', 'ai_basic'] }])),
              })),
            })),
          })),
        })),
      });

      const { requireAiFeature } = await import('@/lib/ai/plan-gate');
      const ctx = { isSuperAdmin: false, tenantId: 't1' } as Parameters<typeof requireAiFeature>[0];
      const result = await requireAiFeature(ctx, 'ai_sentiment');
      expect(result).toBeNull();
    });

    it('handles null row gracefully', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: vi.fn((fn: (r: unknown[]) => unknown) => fn([undefined])),
              })),
            })),
          })),
        })),
      });

      const { requireAiFeature } = await import('@/lib/ai/plan-gate');
      const ctx = { isSuperAdmin: false, tenantId: 't1' } as Parameters<typeof requireAiFeature>[0];
      const result = await requireAiFeature(ctx, 'ai_anything');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });
  });

  describe('planHasFeature', () => {
    it('returns true when feature is in plan', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: vi.fn((fn: (r: unknown[]) => unknown) => fn([{ features: ['ai_advanced'] }])),
              })),
            })),
          })),
        })),
      });

      const { planHasFeature } = await import('@/lib/ai/plan-gate');
      const result = await planHasFeature('t1', 'ai_advanced');
      expect(result).toBe(true);
    });

    it('returns false when feature not in plan', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                then: vi.fn((fn: (r: unknown[]) => unknown) => fn([{ features: ['ai_basic'] }])),
              })),
            })),
          })),
        })),
      });

      const { planHasFeature } = await import('@/lib/ai/plan-gate');
      const result = await planHasFeature('t1', 'ai_advanced');
      expect(result).toBe(false);
    });
  });
});

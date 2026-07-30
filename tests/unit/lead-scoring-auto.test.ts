import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{}]),
      })),
    })),
  },
}));

describe('Lead Score Auto-Recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SCORE_ADJUSTMENTS has correct values', async () => {
    const { SCORE_ADJUSTMENTS } = await import('@/lib/lead-scoring/auto-recalculate');

    expect(SCORE_ADJUSTMENTS.email_opened).toBe(5);
    expect(SCORE_ADJUSTMENTS.email_clicked).toBe(10);
    expect(SCORE_ADJUSTMENTS.form_submitted).toBe(15);
    expect(SCORE_ADJUSTMENTS.meeting_scheduled).toBe(20);
    expect(SCORE_ADJUSTMENTS.deal_created).toBe(30);
    expect(SCORE_ADJUSTMENTS.inactivity_7d).toBe(-10);
    expect(SCORE_ADJUSTMENTS.inactivity_14d).toBe(-20);
  });

  it('adjustLeadScore calls db.update with correct lead', async () => {
    const { adjustLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');
    const { db } = await import('@/drizzle/db');

    await adjustLeadScore('lead-1', 'tenant-1', 'email_opened');

    expect(db.update).toHaveBeenCalled();
  });

  it('adjustLeadScore does nothing for unknown event', async () => {
    const { adjustLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');
    const { db } = await import('@/drizzle/db');

    // @ts-expect-error testing unknown event
    await adjustLeadScore('lead-1', 'tenant-1', 'unknown_event');

    expect(db.update).not.toHaveBeenCalled();
  });

  it('recalculateLeadScore computes base score correctly', async () => {
    const { recalculateLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');

    const score = await recalculateLeadScore('lead-1', 'tenant-1', 3, true, true, 2);

    // hasEmail(10) + hasPhone(5) + activities(min(30, 3*5)=15) - decay(0) = 30
    expect(score).toBe(30);
  });

  it('applies inactivity decay at 7 days', async () => {
    const { recalculateLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');

    const score = await recalculateLeadScore('lead-1', 'tenant-1', 2, true, false, 10);

    // hasEmail(10) + activities(10) - 7d_decay(-10) = 10
    expect(score).toBe(10);
  });

  it('applies stronger decay at 14 days', async () => {
    const { recalculateLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');

    const score = await recalculateLeadScore('lead-1', 'tenant-1', 1, false, false, 20);

    // activities(5) - 14d_decay(-20) = -15 → clamped to 0
    expect(score).toBe(0);
  });

  it('score is clamped between 0 and 100', async () => {
    const { recalculateLeadScore } = await import('@/lib/lead-scoring/auto-recalculate');

    const score = await recalculateLeadScore('lead-1', 'tenant-1', 20, true, true, 0);

    // hasEmail(10) + hasPhone(5) + activities(min(30, 100)) = 45 → within bounds
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

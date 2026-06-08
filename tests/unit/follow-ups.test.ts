import { describe, it, expect } from 'vitest';

describe('follow-ups schemas', () => {
  it('createFollowUpSchema validates a valid input', async () => {
    const { createFollowUpSchema } = await import('@/lib/api/schemas');
    const result = createFollowUpSchema.safeParse({
      title: 'Follow up on proposal',
    });
    expect(result.success).toBe(true);
  });

  it('createFollowUpSchema accepts null UUIDs', async () => {
    const { createFollowUpSchema } = await import('@/lib/api/schemas');
    const result = createFollowUpSchema.safeParse({
      title: 'Follow up',
      lead_id: null,
    });
    expect(result.success).toBe(true);
  });

  it('createFollowUpSchema rejects empty title', async () => {
    const { createFollowUpSchema } = await import('@/lib/api/schemas');
    const result = createFollowUpSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('createFollowUpSchema rejects invalid status', async () => {
    const { createFollowUpSchema } = await import('@/lib/api/schemas');
    const result = createFollowUpSchema.safeParse({
      title: 'Test',
      status: 'invalid_status',
    });
    expect(result.success).toBe(false);
  });

  it('updateFollowUpSchema allows partial updates', async () => {
    const { updateFollowUpSchema } = await import('@/lib/api/schemas');
    const result = updateFollowUpSchema.safeParse({
      title: 'Updated title',
      status: 'completed',
    });
    expect(result.success).toBe(true);
  });

  it('updateFollowUpSchema allows empty object', async () => {
    const { updateFollowUpSchema } = await import('@/lib/api/schemas');
    const result = updateFollowUpSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('followUpQuerySchema parses query params', async () => {
    const { followUpQuerySchema } = await import('@/lib/api/schemas');
    const result = followUpQuerySchema.safeParse({
      offset: 10,
      limit: 50,
      status: 'pending',
      missed_only: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(10);
      expect(result.data.limit).toBe(50);
      expect(result.data.missed_only).toBe(true);
    }
  });

  it('followUpQuerySchema defaults', async () => {
    const { followUpQuerySchema } = await import('@/lib/api/schemas');
    const result = followUpQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(0);
      expect(result.data.limit).toBe(50);
      expect(result.data.missed_only).toBe(false);
    }
  });
});

describe('follow-ups cron', () => {
  it('cron route module loads', async () => {
    const mod = await import('@/app/api/cron/detect-missed-followups/route');
    expect(mod.POST).toBeDefined();
  });
});

describe('follow-ups dashboard widget', () => {
  it('widget module loads', async () => {
    const mod = await import('@/components/tenant/dashboard/widgets/follow-ups-widget');
    expect(mod.default).toBeDefined();
  });
});

describe('MissedFollowUpBadge', () => {
  it('component module loads', async () => {
    const mod = await import('@/components/tenant/follow-ups/missed-followup-badge');
    expect(mod.MissedFollowUpBadge).toBeDefined();
  });
});

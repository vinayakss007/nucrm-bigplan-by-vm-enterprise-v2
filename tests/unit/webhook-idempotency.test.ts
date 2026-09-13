import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chain state controlled per test.
let insertRows: unknown[] = [{ id: 'claim-1' }];
let updateRows: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => insertRows),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateRows),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  claimWebhookEvent,
  completeWebhookEvent,
  releaseWebhookEvent,
} from '@/lib/webhooks/idempotency';
import { db } from '@/drizzle/db';

describe('webhook idempotency ledger (#1908)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertRows = [{ id: 'claim-1' }];
    updateRows = [];
  });

  it('first delivery wins the claim', async () => {
    const won = await claimWebhookEvent({ provider: 'stripe', eventId: 'evt_1', eventType: 'checkout.session.completed' });
    expect(won).toBe(true);
  });

  it('replay loses the claim (duplicate)', async () => {
    insertRows = []; // ON CONFLICT DO NOTHING → no row
    updateRows = []; // fresh 'claimed' row → not stealable
    const won = await claimWebhookEvent({ provider: 'stripe', eventId: 'evt_1' });
    expect(won).toBe(false);
  });

  it('stale claimed rows (crashed worker) are stolen so retries process', async () => {
    insertRows = [];
    updateRows = [{ id: 'claim-1' }]; // steal UPDATE matched
    const won = await claimWebhookEvent({ provider: 'razorpay', eventId: 'evt_old' });
    expect(won).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it('complete marks the event processed', async () => {
    await completeWebhookEvent('stripe', 'evt_1');
    expect(db.update).toHaveBeenCalled();
  });

  it('release deletes the claim so retries re-process', async () => {
    await releaseWebhookEvent('stripe', 'evt_1');
    expect(db.delete).toHaveBeenCalled();
  });
});

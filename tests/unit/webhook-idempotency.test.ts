import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryBuilder, PgDialect } from 'drizzle-orm/pg-core';

// Chain state controlled per test.
let insertRows: unknown[] = [{ id: 'claim-1' }];
let updateRows: unknown[] = [];
// The SET payload of the steal UPDATE (captured to prove created_at is stamped).
let setPayloads: Record<string, unknown>[] = [];
// #2237: the WHERE the stale-claim steal runs with, captured for SQL shape
// assertions (NULL-tolerance must be provable, not just commented).
let stealConditions: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => insertRows),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        setPayloads.push(v);
        return {
          where: vi.fn((cond: unknown) => {
            stealConditions.push(cond);
            return {
              returning: vi.fn(async () => updateRows),
            };
          }),
        };
      }),
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
import { webhookEvents } from '@/drizzle/schema';

/** Render a captured drizzle condition the way Postgres will see it. */
function renderWhere(cond: unknown): string {
  return new QueryBuilder(new PgDialect())
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(cond as never)
    .toSQL().sql;
}

describe('webhook idempotency ledger (#1908)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertRows = [{ id: 'claim-1' }];
    updateRows = [];
    setPayloads = [];
    stealConditions = [];
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

describe('stale-claim sweeper NULL tolerance (#2237)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertRows = []; // conflict path — always reach the steal UPDATE
    updateRows = [{ id: 'claim-1' }];
    setPayloads = [];
    stealConditions = [];
  });

  it('steal condition matches rows with NULL created_at (wedge closed)', async () => {
    const won = await claimWebhookEvent({ provider: 'stripe', eventId: 'evt_null' });
    expect(won).toBe(true);
    expect(stealConditions).toHaveLength(1);
    const sqlText = renderWhere(stealConditions[0]);
    // The old shape — `created_at < $n` with no NULL branch — could never
    // match a NULL row, wedging that UNIQUE(provider, event_id) claim forever.
    expect(sqlText).toContain('"webhook_events"."created_at" is null');
    expect(sqlText).toMatch(/"webhook_events"."created_at" < \$/);
  });

  it('NULL branch is ordered before the age comparison (unknown age = stale)', async () => {
    await claimWebhookEvent({ provider: 'razorpay', eventId: 'evt_null2' });
    const sqlText = renderWhere(stealConditions[0]);
    const nullPos = sqlText.indexOf('is null');
    const ltPos = sqlText.search(/"created_at" < /);
    expect(nullPos).toBeGreaterThan(-1);
    expect(ltPos).toBeGreaterThan(-1);
    expect(nullPos).toBeLessThan(ltPos);
    // Both branches sit inside one OR — the status/provider/event equality
    // guards must stay outside it so a 'processed' row is never stolen.
    expect(sqlText).toMatch(/\("webhook_events"\."created_at" is null or "webhook_events"\."created_at" < /);
    expect(sqlText).toContain('"webhook_events"."status" = $');
  });

  it('a stolen NULL row gets created_at stamped, healing it permanently', async () => {
    // The steal UPDATE ... .set({ createdAt: new Date() }) runs with the same
    // condition; after it, created_at is non-NULL and normal age logic applies.
    await claimWebhookEvent({ provider: 'stripe', eventId: 'evt_null3' });
    expect(setPayloads.length).toBeGreaterThan(0);
    expect(setPayloads[0]).toHaveProperty('createdAt');
    expect(setPayloads[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('fresh non-NULL claims are NOT stealable (age check still enforced)', async () => {
    // Rendering guard: the lt branch must still exist with a cutoff param —
    // we only added the NULL branch, we did not make all claims stealable.
    updateRows = []; // fresh row → WHERE matches nothing → claim lost
    const won = await claimWebhookEvent({ provider: 'stripe', eventId: 'evt_fresh' });
    expect(won).toBe(false);
    const sqlText = renderWhere(stealConditions[0]);
    expect(sqlText).toMatch(/"created_at" < \$/);
  });
});

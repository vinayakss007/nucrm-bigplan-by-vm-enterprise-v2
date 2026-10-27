/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3299, second half — `processWebhookDelivery` already calls `safeFetch`, so a rebinding target is
 * *refused* here. What it then does with the refusal is the bug: an `SsrfBlockedError` falls into the
 * generic catch and takes the retry ladder, so the row goes back to `pending` with a
 * `nextRetryAt`, and only after the ladder exhausts does it reach the dead letter queue.
 *
 * The address is not going to stop being private. `lib/webhooks.ts:157-170` already treats this error
 * class as never-retryable and records the reason; this is the same rule on the path that ships the
 * `deliveryId` jobs the queue consumes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PUBLIC_IP = '93.184.216.34';
const METADATA_IP = '169.254.169.254';
const DELIVERY_ID = '30000000-0000-4000-8000-000000000003';
const HOOK_URL = 'https://hook.tenant-invalid.test/orders';

const H = vi.hoisted(() => ({
  fetches: [] as string[],
  writes: [] as Record<string, unknown>[],
  dlq: [] as string[],
  dns: {} as Record<string, string[]>,
}));

vi.mock('dns/promises', () => ({
  resolve4: async (hostname: string) => (H.dns[hostname] ?? []).map((address) => ({ address, ttl: 60 })),
  resolve6: async () => [],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      webhookDeliveries: {
        findFirst: async () => ({
          id: DELIVERY_ID,
          webhookId: 'wh-1',
          tenantId: '10000000-0000-4000-8000-000000000001',
          eventType: 'deal.updated',
          payload: { event: 'deal.updated' },
          status: 'pending',
          // First attempt of three: the retry ladder is what a block must not enter.
          metadata: { url: HOOK_URL, attempt: 0, max_retries: 3 },
        }),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        H.writes.push(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock('@/lib/webhooks/dlq', () => ({
  moveToDeadLetterQueue: vi.fn(async (deliveryId: string) => {
    H.dlq.push(deliveryId);
    return 'dlq-1';
  }),
}));

beforeEach(() => {
  H.fetches = [];
  H.writes = [];
  H.dlq = [];
  H.dns = { 'hook.tenant-invalid.test': [PUBLIC_IP] };
  // generateSignature refuses the shipped placeholder value outright, and the refusal happens before
  // any socket — without this the whole file would be red for the wrong reason.
  process.env['WEBHOOK_SECRET'] = 'test-webhook-secret-value';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    H.fetches.push(String(url));
    return { ok: true, status: 200, statusText: 'OK', text: async () => 'accepted' };
  }));
});

const processDelivery = async () => {
  const { processWebhookDelivery } = await import('@/lib/webhooks/delivery');
  return processWebhookDelivery(DELIVERY_ID, HOOK_URL);
};

describe('#3299: an SSRF refusal ends the delivery, it does not schedule another', () => {
  it('a blocked target is dead-lettered on the first attempt, not returned to pending', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    await processDelivery();
    const statuses = H.writes.map((w) => w['status']);
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('pending');
    expect(H.dlq).toEqual([DELIVERY_ID]);
  });

  it('the row records the reason a human can act on', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    await processDelivery();
    const recorded = JSON.stringify(H.writes);
    expect(recorded).toMatch(/SSRF/);
    expect(recorded).toContain(METADATA_IP);
  });

  it('no retry is scheduled for a target that will stay blocked', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    await processDelivery();
    const nextRetry = H.writes.flatMap((w) =>
      Object.entries((w['metadata'] ?? {}) as Record<string, unknown>).filter(([k]) => k === 'nextRetryAt'));
    expect(nextRetry).toEqual([]);
  });

  it('and the socket was never opened for it', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    await processDelivery();
    expect(H.fetches).toHaveLength(0);
  });

  it('a public target still delivers and records success — the rule is not a blanket block', async () => {
    await processDelivery();
    expect(H.fetches).toEqual([HOOK_URL]);
    expect(H.writes.map((w) => w['status'])).toContain('success');
    expect(H.dlq).toEqual([]);
  });

  it('a plain HTTP failure keeps the ladder it always had', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      H.fetches.push(String(url));
      return { ok: false, status: 500, statusText: 'Server Error', text: async () => '' };
    }));
    await processDelivery();
    expect(H.writes.map((w) => w['status'])).toContain('pending');
    expect(H.dlq).toEqual([]);
  });
});

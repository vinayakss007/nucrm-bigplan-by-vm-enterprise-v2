/**
 * #3127 — `updateDeliveryStatus()` discarded the UPDATE it ran and returned
 * `{ updated: true }` unconditionally, so `/api/tenant/sms/webhook` echoed that
 * back to Twilio even when zero rows matched `MessageSid`. A replayed Sid, a
 * message already past the retention window, or a signature-valid ping for a Sid
 * this deployment never sent therefore looked like recorded delivery tracking,
 * and nothing on the tenant side could tell the difference.
 *
 * The write now claims its row with RETURNING, so `updated` describes the write
 * and the unmatched case names the Sid it could not place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  returningRows: [] as Array<{ id: string }>,
  whereCalls: 0,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => {
          h.whereCalls += 1;
          return { returning: async () => h.returningRows };
        },
      }),
    }),
  },
}));

vi.mock('@/lib/rate-limit-simple', () => ({ checkPublicRateLimit: () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

import { POST } from '@/app/api/tenant/sms/webhook/route';

function statusCallback(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request('http://localhost.test/api/tenant/sms/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  h.returningRows = [];
  h.whereCalls = 0;
});

describe('POST /api/tenant/sms/webhook — a status callback answers for the row it touched (#3127)', () => {
  it('reports updated:false and names the Sid when no row matches', async () => {
    h.returningRows = [];

    const res = await POST(statusCallback({ MessageSid: 'SM-never-sent', MessageStatus: 'delivered' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      updated: false,
      status: 'delivered',
      unmatchedMessageSid: 'SM-never-sent',
    });
  });

  it('still reports updated:true when the write claims a row', async () => {
    h.returningRows = [{ id: 'msg-1' }];

    const res = await POST(statusCallback({ MessageSid: 'SM-123', MessageStatus: 'undelivered', ErrorCode: '30007' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true, status: 'failed' });
  });

  it('runs exactly one UPDATE for the callback', async () => {
    h.returningRows = [{ id: 'msg-1' }];
    await POST(statusCallback({ MessageSid: 'SM-123', MessageStatus: 'sent' }));

    expect(h.whereCalls).toBe(1);
  });
});

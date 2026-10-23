/**
 * #3127 — updateDeliveryStatus() discarded the UPDATE result and answered
 * `updated: true` even when no smsMessages row matched the callback's
 * MessageSid. The webhook echoed that to Twilio and the tenant UI, so a
 * dropped status update looked applied. It must report what the write did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  setPayload: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        state.setPayload = vals;
        return {
          where: () => ({
            returning: async () => state.rows,
          }),
        };
      },
    }),
    insert: () => ({
      values: () => ({ returning: async () => [{ id: 'msg-1' }] }),
    }),
    query: { contacts: { findFirst: async () => undefined } },
  },
}));
vi.mock('@/drizzle/schema/sms', () => ({
  smsMessages: { id: 'sms.id', twilioSid: 'sms.twilio_sid', status: 'sms.status' },
  smsTemplates: {},
}));
vi.mock('@/drizzle/schema', () => ({ contacts: { phone: 'contacts.phone' } }));

import { updateDeliveryStatus } from '@/lib/sms';

beforeEach(() => {
  state.rows = [];
  state.setPayload = undefined;
});

describe('#3127 updateDeliveryStatus reports what the write did', () => {
  const payload = {
    MessageSid: 'SM00000000000000000000000000000001',
    MessageStatus: 'delivered',
    ErrorCode: undefined,
    ErrorMessage: undefined,
  };

  it('returns updated:false when no row matched the MessageSid', async () => {
    state.rows = [];
    const res = await updateDeliveryStatus(payload);
    expect(res.updated).toBe(false);
    expect(res.status).toBe('delivered');
  });

  it('returns updated:true only when the write actually matched a row', async () => {
    state.rows = [{ id: 'msg-1' }];
    const res = await updateDeliveryStatus(payload);
    expect(res.updated).toBe(true);
    expect(res.status).toBe('delivered');
  });

  it('still maps undelivered to failed and persists the error code', async () => {
    state.rows = [{ id: 'msg-1' }];
    const res = await updateDeliveryStatus({
      ...payload,
      MessageStatus: 'undelivered',
      ErrorCode: '30008',
    });
    expect(res.status).toBe('failed');
    expect(state.setPayload).toMatchObject({ status: 'failed', errorCode: '30008' });
  });
});

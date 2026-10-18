/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { updateDealSchema, createDealSchema } from '@/lib/api/schemas';

// #2627 — `createDealSchema.partial()` inherited `.default(0)` on amount and
// `.default({})` on metadata, so a PATCH body that never mentioned those keys
// was parsed to `{ amount: 0, metadata: {} }` and the handler wrote those
// values back over the stored deal. These tests lock in the fix: the update
// schema must NOT synthesise a value the client did not send.
describe('updateDealSchema — PATCH with no amount must not zero the deal (#2627)', () => {
  it('omits amount from the parsed output when the client did not send it', () => {
    const parsed = updateDealSchema.parse({ title: 'rename only' });
    expect('amount' in parsed).toBe(false);
    expect(parsed.amount).toBeUndefined();
  });

  it('omits metadata from the parsed output when the client did not send it', () => {
    const parsed = updateDealSchema.parse({ title: 'rename only' });
    expect('metadata' in parsed).toBe(false);
    expect(parsed.metadata).toBeUndefined();
  });

  it('preserves an explicitly-sent amount of 0 (zero is still a legal write)', () => {
    const parsed = updateDealSchema.parse({ amount: 0 });
    expect(parsed.amount).toBe(0);
  });

  it('preserves an explicitly-sent amount when other fields are updated', () => {
    const parsed = updateDealSchema.parse({ title: 'x', amount: 4500 });
    expect(parsed.amount).toBe(4500);
  });

  it('stage-only PATCH leaves amount + metadata out of the output', () => {
    const parsed = updateDealSchema.parse({ stage_id: '50000000-0000-0000-0000-000000000002' });
    expect('amount' in parsed).toBe(false);
    expect('metadata' in parsed).toBe(false);
  });

  it('createDealSchema still defaults amount=0 and metadata={} on POST (unchanged)', () => {
    const parsed = createDealSchema.parse({
      title: 'new deal',
      stage_id: '50000000-0000-0000-0000-000000000001',
      pipeline_id: '40000000-0000-0000-0000-000000000001',
    });
    expect(parsed.amount).toBe(0);
    expect(parsed.metadata).toEqual({});
  });
});

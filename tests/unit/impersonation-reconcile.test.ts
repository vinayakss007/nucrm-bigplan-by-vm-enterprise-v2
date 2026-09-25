/**
 * Unit tests for impersonation membership reconciliation helpers (#1911).
 */
import { describe, it, expect } from 'vitest';
import { parseOriginalMembershipState } from '@/lib/auth/impersonation-reconcile';

describe('parseOriginalMembershipState (#1911)', () => {
  it('returns the recorded state for well-formed notes', () => {
    const notes = JSON.stringify({
      originalMembershipState: { existed: true, status: 'invited', roleSlug: 'sales_rep' },
    });
    expect(parseOriginalMembershipState(notes)).toEqual({
      existed: true,
      status: 'invited',
      roleSlug: 'sales_rep',
    });
  });

  it('fails closed to remove-membership when notes are missing', () => {
    for (const notes of [null, undefined, '', 42, {}]) {
      expect(parseOriginalMembershipState(notes)).toEqual({
        existed: false,
        status: 'active',
        roleSlug: 'member',
      });
    }
  });

  it('fails closed on malformed JSON', () => {
    expect(parseOriginalMembershipState('{not json').existed).toBe(false);
  });

  it('fails closed when the JSON lacks originalMembershipState', () => {
    expect(parseOriginalMembershipState(JSON.stringify({ reason: 'x' })).existed).toBe(false);
  });

  it('fails closed on partially-shaped state (wrong types rejected)', () => {
    const notes = JSON.stringify({ originalMembershipState: { existed: 'yes', roleSlug: 1 } });
    expect(parseOriginalMembershipState(notes)).toEqual({
      existed: false,
      status: 'active',
      roleSlug: 'member',
    });
  });
});

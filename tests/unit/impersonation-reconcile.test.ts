/**
 * Unit tests for impersonation membership reconciliation helpers (#1911).
 */
import { describe, it, expect } from 'vitest';
import { parseImpersonationNotes, parseOriginalMembershipState } from '@/lib/auth/impersonation-reconcile';

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

describe('parseImpersonationNotes', () => {
  it('reads the session hashes stop needs to revoke the impersonated login', () => {
    const notes = JSON.stringify({
      originalMembershipState: { existed: false, status: 'active', roleSlug: 'member' },
      tokenHash: 'abc',
      adminTokenHash: 'def',
    });
    expect(parseImpersonationNotes(notes)).toMatchObject({ tokenHash: 'abc', adminTokenHash: 'def' });
  });

  it('returns an empty record rather than throwing on missing or malformed notes', () => {
    for (const notes of [null, undefined, '', 'not json', 42]) {
      expect(parseImpersonationNotes(notes)).toEqual({});
    }
  });

  it('re-impersonation inherits the state the open session captured, not the elevated one', () => {
    // start upgrades tenant_members to admin, so a second start that read the
    // live row would record `admin` as the original and stop would leave a
    // permanent super-admin membership behind.
    const first = JSON.stringify({
      originalMembershipState: { existed: true, status: 'active', roleSlug: 'member' },
      tokenHash: 't1',
    });
    expect(parseOriginalMembershipState(first)).toEqual({ existed: true, status: 'active', roleSlug: 'member' });
  });
});

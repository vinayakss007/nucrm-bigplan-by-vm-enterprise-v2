/**
 * #3407 — the tenant_members registry owns the active↔inactive rule shared by
 * SCIM provision/deprovision. Fail closed on an unknown target.
 */
import { describe, it, expect } from 'vitest';
import { allowedMemberFromStatus, canTransitionMember } from '../../lib/membership';
import { allowedFromStatus, canTransition } from '../../lib/state/transitions';

describe('tenant_members transition registry', () => {
  it('reuses the membership map through the central registry', () => {
    expect(canTransition('tenantMembers', 'inactive', 'active')).toBe(true);
    expect(canTransition('tenantMembers', 'active', 'inactive')).toBe(true);
    expect(canTransition('tenantMembers', 'active', 'active')).toBe(true);
    expect(allowedFromStatus('tenantMembers', 'active')).toEqual(['active', 'inactive']);
  });

  it('fails closed on an unknown target', () => {
    expect(allowedMemberFromStatus('bogus')).toEqual([]);
    expect(canTransitionMember('active', 'bogus')).toBe(false);
  });
});

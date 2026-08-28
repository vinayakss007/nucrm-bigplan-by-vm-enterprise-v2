/**
 * Regression test for the SSO privilege-escalation fix (audit F1).
 *
 * Auto-provisioned SSO users must never be granted an admin role by default.
 * The previous code fell back to `admin` when `sales_rep` was absent.
 */
import { describe, it, expect } from 'vitest';
import { selectLeastPrivilegeRole, type SelectableRole } from '@/lib/auth/default-role';

const r = (slug: string, sortOrder: number | null = 0, id = slug): SelectableRole => ({ id, slug, sortOrder });

describe('selectLeastPrivilegeRole (SSO default role)', () => {
  it('prefers sales_rep when present', () => {
    const chosen = selectLeastPrivilegeRole([r('admin'), r('sales_rep'), r('member')]);
    expect(chosen?.slug).toBe('sales_rep');
  });

  it('falls back to member/viewer, NOT admin, when sales_rep is absent', () => {
    const chosen = selectLeastPrivilegeRole([r('admin'), r('member'), r('viewer')]);
    expect(chosen?.slug).toBe('member');
    expect(chosen?.slug).not.toBe('admin');
  });

  it('never returns admin even when it is the highest-sortOrder role', () => {
    const chosen = selectLeastPrivilegeRole([r('admin', 99), r('agent', 1)]);
    expect(chosen?.slug).toBe('agent');
  });

  it('picks the lowest-privilege non-admin role by sortOrder when no preferred slug matches', () => {
    // higher sortOrder == further from admin
    const chosen = selectLeastPrivilegeRole([
      r('admin'),
      r('custom_low', 10),
      r('custom_high', 2),
    ]);
    expect(chosen?.slug).toBe('custom_low');
  });

  it('returns undefined when ONLY admin/super_admin exist (refuse to auto-provision admin)', () => {
    expect(selectLeastPrivilegeRole([r('admin'), r('super_admin')])).toBeUndefined();
  });

  it('returns undefined for an empty role list', () => {
    expect(selectLeastPrivilegeRole([])).toBeUndefined();
  });

  it('never selects admin or super_admin across a mixed set', () => {
    const chosen = selectLeastPrivilegeRole([
      r('super_admin', 100), r('admin', 90), r('sales_rep', 5), r('viewer', 20),
    ]);
    expect(['admin', 'super_admin']).not.toContain(chosen?.slug);
    expect(chosen?.slug).toBe('sales_rep');
  });
});

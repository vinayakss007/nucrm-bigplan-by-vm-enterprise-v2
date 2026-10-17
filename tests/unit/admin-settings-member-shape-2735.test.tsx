// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2735 — the Organization Settings page labels every colleague "User · member".
 *
 * `app/tenant/settings/admin/page.tsx:33-38` declares the row it renders as
 * `{ id, full_name, email, role_slug }` and `:52-54` fills it from
 * `GET /api/tenant/members`, whose projection is camelCase
 * (`app/api/tenant/members/route.ts:142-161`: `userId`, `fullName`, `roleSlug`,
 * `roleName`). `useApiQuery<{ data?: Member[] }>` is a cast, not a conversion, so
 * the three reads in the recent-members card — the initial (`:309`),
 * `{member.full_name || 'User'}` (`:312`) and `{member.role_slug || 'member'}`
 * (`:318`) — always take their fallbacks. Same drift as #2730, second site: that
 * one was a client `reload()` over Server-Component props, this one is a client
 * fetch typed against a shape the endpoint has never returned.
 *
 * The payload below is the route's real key set. The e-mail initial is chosen to
 * differ from the name initial so the `:309` fallback cannot pass by accident.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseApiQuery = vi.fn();
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (key: readonly unknown[]) => mockUseApiQuery(key),
}));

import OrganizationAdminPage from '@/app/tenant/settings/admin/page';

/** GET /api/tenant/members as it is really shaped, after JSON serialisation. */
const membersPayload = {
  data: [
    { id: 'm1', userId: 'u1', roleSlug: 'sales_rep', status: 'active', joinedAt: '2026-01-05T00:00:00.000Z', fullName: 'Ada Sales', email: 'billing@corp.test', avatarUrl: null, emailVerified: true, roleName: 'Sales Rep', contactCount: 7, dealCount: 2, taskCount: 1 },
    { id: 'm2', userId: 'u2', roleSlug: 'admin', status: 'active', joinedAt: '2026-02-05T00:00:00.000Z', fullName: 'Ravi Admin', email: 'ravi@corp.test', avatarUrl: null, emailVerified: false, roleName: 'Admin', contactCount: 0, dealCount: 0, taskCount: 0 },
  ],
  invitations: [],
  tenantId: 't1',
};

function stubQueries(members: { data?: unknown } | undefined, plan: Record<string, unknown> = { name: 'Pro', max_users: 10 }) {
  mockUseApiQuery.mockImplementation((key: readonly unknown[]) => {
    const name = (key ?? []).map(String).join('/');
    if (name.includes('members')) return { data: members, isLoading: false, error: null };
    return {
      data: { tenant: { name: 'Acme', status: 'active' }, plan, usage: { current_contacts: 40, current_deals: 9 } },
      isLoading: false,
      error: null,
    };
  });
}

describe('the Organization Settings team card reads the shape the API sends (#2735)', () => {
  beforeEach(() => mockUseApiQuery.mockReset());

  it('shows each member their own name, not the "User" fallback', () => {
    stubQueries(membersPayload);
    render(<OrganizationAdminPage />);
    expect(screen.getByText('Ada Sales')).toBeTruthy();
    expect(screen.queryByText('User'), 'every row printing "User" means full_name never arrived').toBeNull();
  });

  it('shows each member their real role, not the "member" fallback', () => {
    stubQueries(membersPayload);
    render(<OrganizationAdminPage />);
    const badges = screen.getAllByText(/^(sales_rep|admin|member)$/);
    expect(badges.map(b => b.textContent).sort()).toEqual(['admin', 'sales_rep']);
  });

  it('takes the avatar initial from the name, not from the e-mail', () => {
    stubQueries(membersPayload);
    render(<OrganizationAdminPage />);
    // Ada's e-mail starts with 'b' (billing@corp.test), her name with 'A'.
    const initials = screen.getAllByText(/^[A-Za-z]$/).map(el => el.textContent);
    expect(initials).toContain('A');
    expect(initials, `initials were ${initials.join(',')}`).not.toContain('B');
  });

  // Controls — true today, must stay true.
  it('still renders the e-mail and counts every member row for the seat alert', () => {
    // The alert only appears above 90% usage, so the plan is cut to two seats.
    stubQueries(membersPayload, { name: 'Pro', max_users: 2 });
    render(<OrganizationAdminPage />);
    expect(screen.getByText('billing@corp.test')).toBeTruthy();
    expect(screen.getByText('ravi@corp.test')).toBeTruthy();
    // {currentUsers} and {maxUsers} are separate text nodes — match the paragraph.
    expect(document.body.textContent).toContain('2 of 2 user seats');
  });

  it('an empty roster still shows the empty state', () => {
    stubQueries({ data: [] });
    render(<OrganizationAdminPage />);
    expect(screen.getByText('No team members yet')).toBeTruthy();
    expect(screen.queryByText('Ada Sales')).toBeNull();
  });
});

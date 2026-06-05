// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsContactsWidget from '@/components/tenant/dashboard/widgets/stats-contacts-widget';

describe('StatsContactsWidget', () => {
  it('renders contact count', () => {
    render(<StatsContactsWidget data={{ count: 150, companyCount: 25 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.getByText('25 companies')).toBeTruthy();
  });

  it('renders total contacts label', () => {
    render(<StatsContactsWidget data={{ count: 50 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('Total Contacts')).toBeTruthy();
  });

  it('handles zero values', () => {
    render(<StatsContactsWidget data={{ count: 0, companyCount: 0 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('shows dash for missing company count', () => {
    render(<StatsContactsWidget data={{ count: 10 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText(/— companies/)).toBeTruthy();
  });
});

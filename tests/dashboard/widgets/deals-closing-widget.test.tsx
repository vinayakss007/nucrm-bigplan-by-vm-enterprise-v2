// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DealsClosingWidget from '@/components/tenant/dashboard/widgets/deals-closing-widget';

describe('DealsClosingWidget', () => {
  it('renders closing deals', () => {
    const items = [
      { id: '1', title: 'Big Deal', value: 50000, stage: 'negotiation' },
      { id: '2', title: 'Small Deal', value: 5000, stage: 'proposal' },
    ];
    render(<DealsClosingWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('Big Deal')).toBeTruthy();
    expect(screen.getByText('Small Deal')).toBeTruthy();
  });

  it('shows empty state', () => {
    render(<DealsClosingWidget data={{ items: [] }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('No deals closing soon')).toBeTruthy();
  });

  it('formats currency values', () => {
    const items = [
      { id: '1', title: 'Enterprise Deal', value: 100000, stage: 'negotiation' },
    ];
    render(<DealsClosingWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('$100,000')).toBeTruthy();
  });
});

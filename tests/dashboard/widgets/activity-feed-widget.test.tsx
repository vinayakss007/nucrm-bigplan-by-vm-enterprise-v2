// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityFeedWidget from '@/components/tenant/dashboard/widgets/activity-feed-widget';

describe('ActivityFeedWidget', () => {
  it('renders activity items', () => {
    const items = [
      { id: '1', type: 'note', description: 'Added a note', full_name: 'Alice', created_at: new Date().toISOString() },
      { id: '2', type: 'call', description: 'Called client', full_name: 'Bob', created_at: new Date().toISOString() },
    ];
    render(<ActivityFeedWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('Added a note')).toBeTruthy();
    expect(screen.getByText('Called client')).toBeTruthy();
  });

  it('shows empty state when no activities', () => {
    render(<ActivityFeedWidget data={{ items: [] }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText(/No activity yet/)).toBeTruthy();
  });

  it('renders View all link', () => {
    render(<ActivityFeedWidget data={{ items: [] }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('View all →')).toBeTruthy();
  });
});

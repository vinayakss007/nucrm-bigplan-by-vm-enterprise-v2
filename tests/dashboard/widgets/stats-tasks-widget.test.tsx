// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsTasksWidget from '@/components/tenant/dashboard/widgets/stats-tasks-widget';

describe('StatsTasksWidget', () => {
  it('renders tasks due today', () => {
    render(<StatsTasksWidget data={{ dueToday: 5, overdue: 2 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2 overdue')).toBeTruthy();
  });

  it('shows None overdue when zero', () => {
    render(<StatsTasksWidget data={{ dueToday: 0, overdue: 0 }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('Get started')).toBeTruthy();
    expect(screen.getByText('None overdue')).toBeTruthy();
  });

  it('shows dash for missing data', () => {
    render(<StatsTasksWidget data={{}} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});

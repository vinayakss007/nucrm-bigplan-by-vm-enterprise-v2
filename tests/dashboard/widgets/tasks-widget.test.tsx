// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TasksWidget from '@/components/tenant/dashboard/widgets/tasks-widget';

describe('TasksWidget', () => {
  it('renders task items', () => {
    const items = [
      { id: '1', title: 'Follow up with lead', priority: 'high', due_date: new Date(Date.now() + 86400000).toISOString().split('T')[0] },
      { id: '2', title: 'Send proposal', priority: 'medium', due_date: null },
    ];
    render(<TasksWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('Follow up with lead')).toBeTruthy();
    expect(screen.getByText('Send proposal')).toBeTruthy();
  });

  it('shows empty state', () => {
    render(<TasksWidget data={{ items: [] }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText('No open tasks')).toBeTruthy();
  });

  it('shows overdue indicator for past dates', () => {
    const items = [
      { id: '1', title: 'Overdue Task', priority: 'high', due_date: '2020-01-01' },
    ];
    render(<TasksWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.getByText(/⚠/)).toBeTruthy();
  });

  it('limits to 5 tasks', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), title: `Task ${i}`, priority: 'low', due_date: null,
    }));
    render(<TasksWidget data={{ items }} tenantId="t1" userId="u1" isAdmin={false} />);
    expect(screen.queryByText('Task 5')).toBeNull();
  });
});

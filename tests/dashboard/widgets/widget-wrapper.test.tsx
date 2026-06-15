// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetSkeleton, WidgetError, WidgetEmpty, WidgetShell } from '@/components/tenant/dashboard/widget-wrapper';
import type { WidgetConfig } from '@/types/dashboard';

const mockWidget: WidgetConfig = {
  id: 'test-widget',
  name: 'Test Widget',
  description: 'A test widget',
  category: 'core',
  defaultSize: '1x1',
  minPlan: 'free',
  refreshInterval: 300,
  apiEndpoint: '/api/test',
};

describe('WidgetSkeleton', () => {
  it('renders with 1x1 size', () => {
    const { container } = render(<WidgetSkeleton size="1x1" />);
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
  });

  it('renders with 2x1 size', () => {
    const { container } = render(<WidgetSkeleton size="2x1" />);
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
  });
});

describe('WidgetError', () => {
  it('renders error message and retry button', () => {
    const onRetry = vi.fn();
    render(<WidgetError message="Something broke" onRetry={onRetry} />);
    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('calls onRetry when retry clicked', () => {
    const onRetry = vi.fn();
    render(<WidgetError message="Error" onRetry={onRetry} />);
    screen.getByText('Retry').click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('WidgetEmpty', () => {
  it('renders empty message', () => {
    render(<WidgetEmpty message="No data" />);
    expect(screen.getByText('No data')).toBeTruthy();
  });
});

describe('WidgetShell', () => {
  const defaultProps = {
    widget: mockWidget,
    size: '1x1',
    tenantId: 't1',
    userId: 'u1',
    isAdmin: false,
    loading: false,
    error: null,
    data: { items: [] },
    onRefresh: vi.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: vi.fn(({ data }: any) => <div>Content: {JSON.stringify(data)}</div>),
  };

  it('renders children with data when loaded', () => {
    render(<WidgetShell {...defaultProps} />);
    expect(screen.getByText(/Content:/)).toBeTruthy();
  });

  it('shows skeleton when loading with no data', () => {
    const { container } = render(<WidgetShell {...defaultProps} loading={true} data={null} />);
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
  });

  it('shows error when error with no data', () => {
    render(<WidgetShell {...defaultProps} error="Fail" data={null} />);
    expect(screen.getByText('Fail')).toBeTruthy();
  });

  it('shows empty when no data and not loading', () => {
    render(<WidgetShell {...defaultProps} data={null} loading={false} />);
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows widget name in header', () => {
    render(<WidgetShell {...defaultProps} />);
    expect(screen.getByText('Test Widget')).toBeTruthy();
  });
});
